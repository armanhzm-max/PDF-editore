import { strFromU8, unzipSync } from "fflate";
import { pdfjs } from "./pdfjs";
import { inspectZipArchive } from "./zip-safety.js";

export type ExtractedDocument = {
  name: string;
  format: string;
  text: string;
  truncated: boolean;
  sourceCount: number;
};

const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_ZIP_UNCOMPRESSED = 200 * 1024 * 1024;
const DEFAULT_MAX_PDF_PAGES = 300;
export type DocumentExtractLimits = { maxFileBytes?: number; maxUncompressedBytes?: number; maxPdfPages?: number };
const MAX_DOC_TEXT = 32_000;
const OOXML_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const DRAW_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";

function estimateZipUncompressedSize(bytes: Uint8Array, maxUncompressedBytes = DEFAULT_MAX_ZIP_UNCOMPRESSED): number {
  return inspectZipArchive(bytes, maxUncompressedBytes, {
    invalid: "document_bad_archive",
    tooLarge: "document_archive_too_large",
    tooManyEntries: "document_archive_too_many_entries",
    zip64: "document_zip64_unsupported",
  });
}

function parseXml(value: string): Document {
  const xml = new DOMParser().parseFromString(value, "application/xml");
  if (xml.getElementsByTagName("parsererror").length) throw new Error("document_invalid_xml");
  return xml;
}

function localText(element: Element, namespace: string, localName: string): string {
  return Array.from(element.getElementsByTagNameNS(namespace, localName)).map((node) => node.textContent ?? "").join("");
}

function limited(text: string, name: string, format: string, sourceCount: number): ExtractedDocument {
  const normalized = text.replace(/\u0000/g, "").trim();
  return {
    name,
    format,
    text: normalized.slice(0, MAX_DOC_TEXT),
    truncated: normalized.length > MAX_DOC_TEXT,
    sourceCount,
  };
}

async function extractPdf(file: File, maxPdfPages = DEFAULT_MAX_PDF_PAGES): Promise<ExtractedDocument> {
  const task = pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > maxPdfPages) throw new Error("document_too_many_pages");
    const chunks: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = content.items
        .filter((item) => typeof (item as { str?: unknown }).str === "string")
        .map((item) => {
          const text = (item as { str: string; hasEOL?: boolean }).str;
          const endLine = (item as { hasEOL?: boolean }).hasEOL;
          return `${text}${endLine ? "\n" : " "}`;
        }).join("").replace(/[ \t]+\n/g, "\n").trim();
      if (lines) chunks.push(`[${file.name} · Page ${pageNumber}]\n${lines}`);
    }
    const text = chunks.join("\n\n");
    if (!text) throw new Error("document_pdf_needs_ocr");
    return limited(text, file.name, "PDF", pdf.numPages);
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

function extractDocx(file: File, bytes: Uint8Array, maxUncompressedBytes: number): ExtractedDocument {
  estimateZipUncompressedSize(bytes, maxUncompressedBytes);
  const archive = unzipSync(bytes);
  const entry = archive["word/document.xml"];
  if (!entry) throw new Error("document_invalid_docx");
  const xml = parseXml(strFromU8(entry));
  const paragraphs = Array.from(xml.getElementsByTagNameNS(OOXML_NS, "p"));
  const chunks = paragraphs.map((paragraph, index) => {
    const text = localText(paragraph, OOXML_NS, "t").trim();
    return text ? `[${file.name} · Paragraph ${index + 1}] ${text}` : "";
  }).filter(Boolean);
  if (!chunks.length) throw new Error("document_no_text");
  return limited(chunks.join("\n"), file.name, "DOCX", chunks.length);
}

function extractXlsx(file: File, bytes: Uint8Array, maxUncompressedBytes: number): ExtractedDocument {
  estimateZipUncompressedSize(bytes, maxUncompressedBytes);
  const archive = unzipSync(bytes);
  const workbookBytes = archive["xl/workbook.xml"];
  const relsBytes = archive["xl/_rels/workbook.xml.rels"];
  if (!workbookBytes || !relsBytes) throw new Error("document_invalid_xlsx");
  const workbook = parseXml(strFromU8(workbookBytes));
  const relationships = parseXml(strFromU8(relsBytes));
  const rels = Array.from(relationships.getElementsByTagName("Relationship"));
  const sheets = Array.from(workbook.getElementsByTagNameNS(SHEET_NS, "sheet"));
  if (!sheets.length) throw new Error("document_invalid_xlsx");
  const sharedBytes = archive["xl/sharedStrings.xml"];
  const sharedDoc = sharedBytes ? parseXml(strFromU8(sharedBytes)) : null;
  const shared = sharedDoc
    ? Array.from(sharedDoc.getElementsByTagNameNS(SHEET_NS, "si")).map((item) => localText(item, SHEET_NS, "t"))
    : [];
  const lines: string[] = [];
  let processedCells = 0;
  for (const sheetInfo of sheets.slice(0, 10)) {
    const sheetName = sheetInfo.getAttribute("name") || "Sheet";
    const relationshipId = sheetInfo.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || sheetInfo.getAttribute("r:id") || "";
    const rel = rels.find((item) => item.getAttribute("Id") === relationshipId);
    if (!rel) continue;
    let target = rel.getAttribute("Target") || "";
    if (target.startsWith("/")) target = target.slice(1);
    else target = `xl/${target}`;
    const normalized: string[] = [];
    for (const part of target.split("/")) {
      if (part === "..") normalized.pop();
      else if (part !== "." && part) normalized.push(part);
    }
    target = normalized.join("/");
    if (!target.startsWith("xl/")) continue;
    const sheetBytes = archive[target];
    if (!sheetBytes) continue;
    const sheet = parseXml(strFromU8(sheetBytes));
    for (const cell of Array.from(sheet.getElementsByTagNameNS(SHEET_NS, "c"))) {
      processedCells += 1;
      if (processedCells > 5000) break;
      const ref = cell.getAttribute("r") || "?";
      const type = cell.getAttribute("t") || "";
      const valueNode = cell.getElementsByTagNameNS(SHEET_NS, "v")[0];
      let value = valueNode?.textContent ?? "";
      if (type === "s") value = shared[Number(value)] ?? "";
      else if (type === "inlineStr") value = localText(cell, SHEET_NS, "t");
      const formula = cell.getElementsByTagNameNS(SHEET_NS, "f")[0]?.textContent;
      if (formula) value = `${value}${value ? " " : ""}(formula: =${formula})`;
      if (value.trim()) lines.push(`[${file.name} · ${sheetName}!${ref}] ${value}`);
    }
    if (processedCells > 5000) break;
  }
  if (!lines.length) throw new Error("document_no_text");
  return limited(lines.join("\n"), file.name, "XLSX", lines.length);
}

function extractPptx(file: File, bytes: Uint8Array, maxUncompressedBytes: number): ExtractedDocument {
  estimateZipUncompressedSize(bytes, maxUncompressedBytes);
  const archive = unzipSync(bytes);
  const presentationBytes = archive["ppt/presentation.xml"];
  const relsBytes = archive["ppt/_rels/presentation.xml.rels"];
  if (!presentationBytes || !relsBytes) throw new Error("document_invalid_pptx");
  const presentation = parseXml(strFromU8(presentationBytes));
  const relationships = parseXml(strFromU8(relsBytes));
  const rels = Array.from(relationships.getElementsByTagName("Relationship"));
  const slideIds = Array.from(presentation.getElementsByTagNameNS("http://schemas.openxmlformats.org/presentationml/2006/main", "sldId"));
  if (!slideIds.length || slideIds.length > 100) throw new Error("document_invalid_pptx");
  const slideNames = slideIds.map((slideId) => {
    const relationshipId = slideId.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || slideId.getAttribute("r:id") || "";
    const relation = rels.find((item) => item.getAttribute("Id") === relationshipId);
    if (!relation) throw new Error("document_invalid_pptx");
    let target = relation.getAttribute("Target") || "";
    if (target.startsWith("/")) target = target.slice(1);
    else target = `ppt/${target}`;
    const normalized: string[] = [];
    for (const part of target.split("/")) {
      if (part === "..") normalized.pop();
      else if (part !== "." && part) normalized.push(part);
    }
    const path = normalized.join("/");
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(path) || !archive[path]) throw new Error("document_invalid_pptx");
    return path;
  });
  const chunks: string[] = [];
  slideNames.forEach((name, index) => {
    const slideBytes = archive[name];
    if (!slideBytes) return;
    const xml = parseXml(strFromU8(slideBytes));
    const paragraphs = Array.from(xml.getElementsByTagNameNS(DRAW_NS, "p"));
    const text = paragraphs.map((p) => localText(p, DRAW_NS, "t").trim()).filter(Boolean).join("\n");
    if (text) chunks.push(`[${file.name} · Slide ${index + 1}]\n${text}`);
  });
  if (!chunks.length) throw new Error("document_no_text");
  return limited(chunks.join("\n\n"), file.name, "PPTX", slideNames.length);
}

export async function extractDocument(file: File, limits: DocumentExtractLimits = {}): Promise<ExtractedDocument> {
  const maxFileBytes = limits.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxUncompressedBytes = limits.maxUncompressedBytes ?? DEFAULT_MAX_ZIP_UNCOMPRESSED;
  const maxPdfPages = limits.maxPdfPages ?? DEFAULT_MAX_PDF_PAGES;
  if (file.size > maxFileBytes) throw new Error("document_file_too_large");
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return extractPdf(file, maxPdfPages);
  if (name.endsWith(".txt") || name.endsWith(".csv") || name.endsWith(".tsv") || file.type.startsWith("text/")) {
    const text = (await file.text()).replace(/^\uFEFF/, "");
    return limited(text, file.name, name.endsWith(".csv") || name.endsWith(".tsv") ? "CSV" : "TXT", text.split(/\r?\n/).length);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (name.endsWith(".docx")) return extractDocx(file, bytes, maxUncompressedBytes);
  if (name.endsWith(".xlsx")) return extractXlsx(file, bytes, maxUncompressedBytes);
  if (name.endsWith(".pptx")) return extractPptx(file, bytes, maxUncompressedBytes);
  throw new Error("document_unsupported");
}
