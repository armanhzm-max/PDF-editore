import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createWorker } from "tesseract.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { zipSync, strToU8 } from "fflate";
import { toOwnedArrayBuffer } from "../core/bytes";
import { pdfjs } from "../core/pdfjs";
import type { Lang } from "../core/i18n";
import { buildRecognizedTranscript } from "../core/workflow";
import type { Plan } from "../core/types";
import { getPlanLimits } from "../core/entitlements";
import { Icon } from "./icons";
import { saveBlobToDeviceOrDownload } from "../core/device-folder";
import { hasExpectedFileSignature, resolveAcceptedMime } from "../core/file-signatures.js";

type ScanMode = "color" | "gray" | "bw";
type ReadingRegion = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };
type WordBox = { text: string; x0: number; y0: number; x1: number; y1: number; confidence: number };
type RegionHandle = "nw" | "ne" | "sw" | "se";
type RegionGesture = { kind: "draw" | "move" | "resize"; start: Point; initial?: ReadingRegion; handle?: RegionHandle };
type ScanPage = {
  id: string;
  file: File;
  previewUrl: string;
  rotation: number;
  mode: ScanMode;
  brightness: number;
  contrast: number;
  denoise: boolean;
  sharpen: boolean;
  ocrRegion?: ReadingRegion;
  ocrText?: string;
  words?: WordBox[];
  confidence?: number;
  /** Keep edited text visible after settings change, but mark it as needing a new OCR pass. */
  ocrNeedsRefresh?: boolean;
};
type Props = { t: (key: string) => string; lang: Lang; plan: Plan; onSendToWord: (name: string, text: string) => void; onSendToDocuments: (name: string, text: string) => void; onSendToTranslator: (name: string, text: string) => void };

const PDF_RENDER_SCALE = 1.8;

function errorKey(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (["scan_invalid_image", "scan_invalid_pdf", "scan_too_many", "scan_file_large", "scan_total_large", "scan_pixels_large", "scan_total_pixels", "scan_ocr_failed", "scan_export_failed"].includes(code)) return code;
  return "scan_invalid_image";
}

async function loadImageSource(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("scan_invalid_image"));
      element.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const image = await loadImageSource(file);
  try { return { width: image.width, height: image.height }; }
  finally { image.close(); }
}

/** Crop only the user's selected reading area and enlarge modestly for OCR. */
function makeOcrCanvas(source: HTMLCanvasElement, region: ReadingRegion | undefined, enhance: boolean, denoise = false, sharpen = false) {
  const left = region ? Math.max(0, Math.min(source.width - 1, Math.round(region.x * source.width))) : 0;
  const top = region ? Math.max(0, Math.min(source.height - 1, Math.round(region.y * source.height))) : 0;
  const width = region ? Math.max(1, Math.min(source.width - left, Math.round(region.width * source.width))) : source.width;
  const height = region ? Math.max(1, Math.min(source.height - top, Math.round(region.height * source.height))) : source.height;
  const longest = Math.max(width, height);
  let scale = Math.min(3, 3200 / longest);
  // Keep OCR image buffers bounded; optional denoise/sharpen needs extra working memory.
  const maxPixels = 6_000_000;
  scale = Math.min(scale, Math.sqrt(maxPixels / (width * height)));
  scale = Math.max(0.5, scale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: false });
  if (!context) throw new Error("canvas_unavailable");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const filters = [
    denoise ? "blur(0.18px)" : "",
    enhance ? "grayscale(1) contrast(1.12) brightness(1.02)" : "",
  ].filter(Boolean);
  if (filters.length) context.filter = filters.join(" ");
  context.drawImage(source, left, top, width, height, 0, 0, canvas.width, canvas.height);
  context.filter = "none";
  if (sharpen && canvas.width > 2 && canvas.height > 2) {
    const sharpenContext = canvas.getContext("2d", { willReadFrequently: true });
    if (sharpenContext) {
      const imageData = sharpenContext.getImageData(0, 0, canvas.width, canvas.height);
      const src = new Uint8ClampedArray(imageData.data);
      const dst = imageData.data;
      const stride = canvas.width * 4;
      // Mild 4-neighbour unsharp kernel; edges are retained and alpha is untouched.
      for (let y = 1; y < canvas.height - 1; y += 1) {
        for (let x = 1; x < canvas.width - 1; x += 1) {
          const index = y * stride + x * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            const center = src[index + channel] * 5;
            const neighbours = src[index - 4 + channel] + src[index + 4 + channel] + src[index - stride + channel] + src[index + stride + channel];
            dst[index + channel] = Math.max(0, Math.min(255, Math.round(center - neighbours)));
          }
        }
      }
      sharpenContext.putImageData(imageData, 0, 0);
    }
  }
  return { canvas, left, top, scale };
}

function normalizedRegion(start: Point, end: Point): ReadingRegion {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return { x, y, width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

async function makeProcessedCanvas(page: ScanPage): Promise<HTMLCanvasElement> {
  const image = await loadImageSource(page.file);
  const sideways = page.rotation % 180 !== 0;
  const canvas = document.createElement("canvas");
  canvas.width = sideways ? image.height : image.width;
  canvas.height = sideways ? image.width : image.height;
  const context = canvas.getContext("2d", { willReadFrequently: page.mode === "bw" });
  if (!context) {
    image.close();
    throw new Error("canvas_unavailable");
  }
  try {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((page.rotation * Math.PI) / 180);
    const brightness = Math.max(70, Math.min(135, page.brightness ?? 100));
    const contrast = Math.max(70, Math.min(160, page.contrast ?? 112));
    const grayscale = page.mode === "color" ? "" : "grayscale(1)";
    const bwBoost = page.mode === "bw" ? " contrast(1.18)" : "";
    context.filter = `${grayscale} brightness(${brightness}%) contrast(${contrast}%)${bwBoost}`.trim();
    context.drawImage(image.source, -image.width / 2, -image.height / 2);
    context.restore();
  } finally {
    image.close();
  }

  if (page.mode === "bw") {
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const histogram = new Uint32Array(256);
    let weightedSum = 0;
    const pixels = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const luminance = Math.max(0, Math.min(255, Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114)));
      histogram[luminance] += 1;
      weightedSum += luminance;
    }
    let backgroundWeight = 0;
    let backgroundSum = 0;
    let bestVariance = -1;
    let threshold = 176;
    for (let value = 0; value < 256; value += 1) {
      backgroundWeight += histogram[value];
      if (!backgroundWeight) continue;
      const foregroundWeight = pixels - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundSum += value * histogram[value];
      const backgroundMean = backgroundSum / backgroundWeight;
      const foregroundMean = (weightedSum - backgroundSum) / foregroundWeight;
      const betweenVariance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
      if (betweenVariance > bestVariance) { bestVariance = betweenVariance; threshold = value; }
    }
    // Avoid extreme thresholds on nearly blank or unusually tinted scans.
    threshold = Math.max(90, Math.min(220, threshold));
    for (let i = 0; i < data.length; i += 4) {
      const luminance = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const value = luminance > threshold ? 255 : 0;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    }
    context.putImageData(imageData, 0, 0);
  }
  return canvas;
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("canvas_unavailable")), "image/jpeg", 0.88);
  });
}

function downloadFile(file: File) {
  void saveBlobToDeviceOrDownload(file, file.name);
}

function escapeXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function paragraphXml(value: string, rtl: boolean): string {
  const bidi = rtl ? "<w:bidi/><w:jc w:val=\"right\"/>" : "";
  const rtlRun = rtl ? "<w:rtl/>" : "";
  return `<w:p><w:pPr>${bidi}</w:pPr><w:r><w:rPr><w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\" w:cs=\"Arial\"/>${rtlRun}</w:rPr><w:t xml:space=\"preserve\">${escapeXml(value)}</w:t></w:r></w:p>`;
}

function createDocx(pages: ScanPage[], lang: Lang): Uint8Array {
  const rtl = lang === "fa";
  const body = pages.map((page, index) => {
    const heading = paragraphXml(lang === "fa" ? `صفحه ${index + 1}` : `Page ${index + 1}`, rtl);
    const paragraphs = (page.ocrText ?? "").replace(/\r/g, "").split("\n").map((line) => paragraphXml(line || " ", rtl)).join("");
    const pageBreak = index < pages.length - 1 ? "<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>" : "";
    return heading + paragraphs + pageBreak;
  }).join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(relationships),
    "word/document.xml": strToU8(documentXml),
  }, { level: 6 });
}

function safeBaseName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-").trim();
  return (base || "scanned-document").slice(0, 80);
}

export default function ScanCenter({ t, lang, plan, onSendToWord, onSendToDocuments, onSendToTranslator }: Props) {
  const { scan: planLimits } = getPlanLimits(plan);
  const MAX_PAGES = planLimits.maxPages;
  const MAX_FILE_BYTES = planLimits.maxFileBytes;
  const MAX_TOTAL_BYTES = planLimits.maxTotalBytes;
  const MAX_PIXELS_PER_PAGE = getPlanLimits(plan).files.maxImagePixelsPerFile;
  const MAX_TOTAL_PIXELS = getPlanLimits(plan).files.maxTotalImagePixels;
  const MAX_IMPORT_FILES = MAX_PAGES;
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [ocrLanguage, setOcrLanguage] = useState("fas+eng");
  const [ocrLayoutMode, setOcrLayoutMode] = useState("3");
  const [enhanceOcr, setEnhanceOcr] = useState(true);
  const [applyRegionToAll, setApplyRegionToAll] = useState(true);
  const [selectingRegion, setSelectingRegion] = useState(false);
  const regionGesture = useRef<RegionGesture | null>(null);
  const [draftRegion, setDraftRegion] = useState<ReadingRegion | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const previewViewport = useRef<HTMLDivElement | null>(null);
  const panGesture = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const previewCanvas = useRef<HTMLCanvasElement | null>(null);
  const urls = useRef<string[]>([]);
  const selected = pages.find((page) => page.id === selectedId) ?? pages[0];
  const recognizedCount = pages.filter((page) => page.ocrText !== undefined).length;
  const allRecognized = pages.length > 0 && recognizedCount === pages.length;
  const hasRecognizedText = pages.some((page) => typeof page.ocrText === "string" && page.ocrText.trim().length > 0);
  const totalBytes = useMemo(() => pages.reduce((sum, page) => sum + page.file.size, 0), [pages]);

  useEffect(() => () => { urls.current.forEach((url) => URL.revokeObjectURL(url)); }, []);

  useEffect(() => {
    const target = previewCanvas.current;
    if (!target || !selected) return;
    let cancelled = false;
    let sourceCanvas: HTMLCanvasElement | null = null;
    void makeProcessedCanvas(selected).then((canvas) => {
      sourceCanvas = canvas;
      if (cancelled || !previewCanvas.current) {
        canvas.width = 0;
        canvas.height = 0;
        return;
      }
      const node = previewCanvas.current;
      node.width = canvas.width;
      node.height = canvas.height;
      const context = node.getContext("2d");
      if (context) context.drawImage(canvas, 0, 0);
      canvas.width = 0;
      canvas.height = 0;
      sourceCanvas = null;
    }).catch(() => {
      if (!cancelled) setError(t("scanPreviewFailed"));
    });
    return () => {
      cancelled = true;
      if (sourceCanvas) { sourceCanvas.width = 0; sourceCanvas.height = 0; }
    };
  }, [selected?.id, selected?.rotation, selected?.mode, t]);

  async function addFiles(fileList: FileList | File[]) {
    setError("");
    setStatus("");
    const createdUrls: string[] = [];
    try {
      const incoming = Array.from(fileList);
      if (!incoming.length) return;
      if (incoming.length > MAX_IMPORT_FILES) throw new Error("scan_too_many");
      if (incoming.some((file) => file.size > MAX_FILE_BYTES)) throw new Error("scan_file_large");
      if (totalBytes + incoming.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) throw new Error("scan_total_large");
      let totalPixels = 0;
      let preparedBytes = 0;
      for (const page of pages) {
        const size = await getImageDimensions(page.file);
        totalPixels += size.width * size.height;
      }
      const prepared: ScanPage[] = [];
      const addPreparedPage = (file: File) => {
        const previewUrl = URL.createObjectURL(file);
        createdUrls.push(previewUrl);
        prepared.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, previewUrl, rotation: 0, mode: "color", brightness: 100, contrast: 112, denoise: false, sharpen: false });
        preparedBytes += file.size;
      };

      for (const file of incoming) {
        const expectedMime = resolveAcceptedMime(file, ["application/pdf", "image/jpeg", "image/png", "image/webp"]);
        if (!expectedMime || !(await hasExpectedFileSignature(file, expectedMime))) throw new Error(expectedMime === "application/pdf" ? "scan_invalid_pdf" : "scan_invalid_image");
        const isPdf = expectedMime === "application/pdf";
        if (isPdf) {
          const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
          const pdf = await loadingTask.promise.catch(() => { throw new Error("scan_invalid_pdf"); });
          try {
            if (!pdf.numPages || pages.length + prepared.length + pdf.numPages > MAX_PAGES) throw new Error("scan_too_many");
            const baseName = file.name.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 70) || "scanned-pdf";
            try {
              for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
                const sourcePage = await pdf.getPage(pageNumber);
                const baseViewport = sourcePage.getViewport({ scale: 1 });
                const scale = Math.min(PDF_RENDER_SCALE, Math.sqrt(MAX_PIXELS_PER_PAGE / Math.max(1, baseViewport.width * baseViewport.height)));
                const viewport = sourcePage.getViewport({ scale });
                const width = Math.max(1, Math.ceil(viewport.width));
                const height = Math.max(1, Math.ceil(viewport.height));
                const pixels = width * height;
                if (!width || !height || pixels > MAX_PIXELS_PER_PAGE) throw new Error("scan_pixels_large");
                totalPixels += pixels;
                if (totalPixels > MAX_TOTAL_PIXELS) throw new Error("scan_total_pixels");
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext("2d", { alpha: false });
                if (!context) throw new Error("canvas_unavailable");
                context.fillStyle = "#fff";
                context.fillRect(0, 0, width, height);
                try {
                  await sourcePage.render({ canvasContext: context, viewport }).promise;
                  const blob = await canvasToJpeg(canvas);
                  const pageFile = new File([blob], `${baseName}-page-${pageNumber}.jpg`, { type: "image/jpeg" });
                  if (totalBytes + preparedBytes + pageFile.size > MAX_TOTAL_BYTES) throw new Error("scan_total_large");
                  addPreparedPage(pageFile);
                } finally {
                  canvas.width = 0;
                  canvas.height = 0;
                  sourcePage.cleanup();
                }
              }
            } catch (renderError) {
              const renderCode = renderError instanceof Error ? renderError.message : "";
              if (["scan_too_many", "scan_pixels_large", "scan_total_pixels", "scan_total_large"].includes(renderCode)) throw renderError;
              throw new Error("scan_invalid_pdf");
            }
          } finally {
            await pdf.destroy();
          }
          continue;
        }

        const size = await getImageDimensions(file);
        const pixels = size.width * size.height;
        if (!size.width || !size.height || pixels > MAX_PIXELS_PER_PAGE) throw new Error("scan_pixels_large");
        totalPixels += pixels;
        if (totalPixels > MAX_TOTAL_PIXELS) throw new Error("scan_total_pixels");
        if (totalBytes + preparedBytes + file.size > MAX_TOTAL_BYTES) throw new Error("scan_total_large");
        addPreparedPage(file);
        if (pages.length + prepared.length > MAX_PAGES) throw new Error("scan_too_many");
      }

      if (pages.length + prepared.length > MAX_PAGES) throw new Error("scan_too_many");
      urls.current.push(...createdUrls);
      setPages((current) => [...current, ...prepared]);
      setSelectedId((current) => current || prepared[0]?.id || "");
      setStatus(t("scanAdded"));
    } catch (caught) {
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
      setError(t(errorKey(caught)));
    } finally {
      if (fileInput.current) fileInput.current.value = "";
      if (cameraInput.current) cameraInput.current.value = "";
    }
  }

  function transformReadingRegion(region: ReadingRegion | undefined, delta: number): ReadingRegion | undefined {
    if (!region) return undefined;
    const rotation = ((delta % 360) + 360) % 360;
    if (rotation === 90) return { x: 1 - region.y - region.height, y: region.x, width: region.height, height: region.width };
    if (rotation === 180) return { x: 1 - region.x - region.width, y: 1 - region.y - region.height, width: region.width, height: region.height };
    if (rotation === 270) return { x: region.y, y: 1 - region.x - region.width, width: region.height, height: region.width };
    return region;
  }

  function updatePage(id: string, patch: Partial<ScanPage>) {
    setPages((current) => current.map((page) => {
      if (page.id !== id) return page;
      let next = { ...page, ...patch };
      if (patch.rotation !== undefined) {
        const delta = (patch.rotation - page.rotation + 360) % 360;
        next.ocrRegion = transformReadingRegion(page.ocrRegion, delta);
      }
      const affectsOcr = patch.rotation !== undefined || patch.mode !== undefined || patch.ocrRegion !== undefined || patch.brightness !== undefined || patch.contrast !== undefined || patch.denoise !== undefined || patch.sharpen !== undefined;
      // Do not discard user-corrected text. Mark it stale until the user explicitly re-runs OCR.
      if (affectsOcr && page.ocrText !== undefined) next.ocrNeedsRefresh = true;
      return next;
    }));
  }

  function setReadingRegion(region: ReadingRegion | undefined) {
    if (!selected) return;
    setPages((current) => current.map((page) => {
      if (!(applyRegionToAll || page.id === selected.id)) return page;
      return { ...page, ocrRegion: region, ocrNeedsRefresh: page.ocrText !== undefined ? true : page.ocrNeedsRefresh };
    }));
    setDraftRegion(null);
    regionGesture.current = null;
  }

  function pointFromClient(clientX: number, clientY: number, layer: HTMLDivElement): Point {
    const bounds = layer.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - bounds.left) / Math.max(1, bounds.width))),
      y: Math.max(0, Math.min(1, (clientY - bounds.top) / Math.max(1, bounds.height))),
    };
  }

  function pointFromEvent(event: ReactPointerEvent<HTMLDivElement>): Point {
    return pointFromClient(event.clientX, event.clientY, event.currentTarget);
  }

  function beginRegionSelection(event: ReactPointerEvent<HTMLDivElement>) {
    if (!selectingRegion || busy) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    regionGesture.current = { kind: "draw", start: point };
    setDraftRegion({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  function beginPreviewPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (selectingRegion || busy || previewZoom <= 1.01 || !previewViewport.current) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const viewport = previewViewport.current;
    panGesture.current = { startX: event.clientX, startY: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function movePreviewPan(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = panGesture.current;
    const viewport = previewViewport.current;
    if (!gesture || !viewport) return;
    viewport.scrollLeft = gesture.scrollLeft - (event.clientX - gesture.startX);
    viewport.scrollTop = gesture.scrollTop - (event.clientY - gesture.startY);
  }

  function finishPreviewPan() {
    panGesture.current = null;
  }

  function beginRegionMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (selectingRegion || busy || !selected?.ocrRegion) return;
    event.stopPropagation();
    const layer = event.currentTarget.closest(".scan-region-layer") as HTMLDivElement | null;
    if (!layer) return;
    layer.setPointerCapture(event.pointerId);
    regionGesture.current = { kind: "move", start: pointFromClient(event.clientX, event.clientY, layer), initial: selected.ocrRegion };
    setDraftRegion(selected.ocrRegion);
  }

  function beginRegionResize(event: ReactPointerEvent<HTMLButtonElement>, handle: RegionHandle) {
    if (selectingRegion || busy || !selected?.ocrRegion) return;
    event.preventDefault();
    event.stopPropagation();
    const layer = event.currentTarget.closest(".scan-region-layer") as HTMLDivElement | null;
    if (!layer) return;
    layer.setPointerCapture(event.pointerId);
    const bounds = layer.getBoundingClientRect();
    const point = { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height))) };
    regionGesture.current = { kind: "resize", start: point, initial: selected.ocrRegion, handle };
    setDraftRegion(selected.ocrRegion);
  }

  function regionFromGesture(gesture: RegionGesture, point: Point): ReadingRegion {
    if (gesture.kind === "draw") return normalizedRegion(gesture.start, point);
    const initial = gesture.initial!;
    const dx = point.x - gesture.start.x;
    const dy = point.y - gesture.start.y;
    if (gesture.kind === "move") {
      return { ...initial, x: Math.max(0, Math.min(1 - initial.width, initial.x + dx)), y: Math.max(0, Math.min(1 - initial.height, initial.y + dy)) };
    }
    const right = initial.x + initial.width;
    const bottom = initial.y + initial.height;
    let left = initial.x;
    let top = initial.y;
    let nextRight = right;
    let nextBottom = bottom;
    if (gesture.handle?.includes("w")) left = Math.max(0, Math.min(right - 0.012, initial.x + dx));
    else nextRight = Math.max(left + 0.012, Math.min(1, right + dx));
    if (gesture.handle?.includes("n")) top = Math.max(0, Math.min(bottom - 0.012, initial.y + dy));
    else nextBottom = Math.max(top + 0.012, Math.min(1, bottom + dy));
    return { x: left, y: top, width: nextRight - left, height: nextBottom - top };
  }

  function moveRegionSelection(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = regionGesture.current;
    if (!gesture || busy) return;
    setDraftRegion(regionFromGesture(gesture, pointFromEvent(event)));
  }

  function finishRegionSelection(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = regionGesture.current;
    if (!gesture) return;
    const region = regionFromGesture(gesture, pointFromEvent(event));
    regionGesture.current = null;
    setDraftRegion(null);
    if (gesture.kind === "draw") setSelectingRegion(false);
    if (region.width < 0.012 || region.height < 0.012) {
      if (gesture.kind === "draw") setError(t("scanRegionTooSmall"));
      return;
    }
    setError("");
    setReadingRegion(region);
    setStatus(applyRegionToAll ? t("scanRegionAppliedAll") : t("scanRegionAppliedPage"));
  }

  function movePage(id: string, direction: -1 | 1) {
    setPages((current) => {
      const index = current.findIndex((page) => page.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removePage(id: string) {
    const target = pages.find((page) => page.id === id);
    if (target) {
      URL.revokeObjectURL(target.previewUrl);
      urls.current = urls.current.filter((url) => url !== target.previewUrl);
    }
    const remaining = pages.filter((page) => page.id !== id);
    if (selectedId === id) setSelectedId(remaining[0]?.id ?? "");
    setPages(remaining);
  }

  async function recognizePages(target: "all" | "selected" | "full") {
    if (!pages.length || busy) return;
    const targets = target === "selected" ? (selected ? [selected] : []) : pages;
    if (!targets.length) return;
    setBusy(true);
    setError("");
    setStatus(t("scanStartingOcr"));
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    try {
      const langPath = import.meta.env.VITE_TESSDATA_URL as string | undefined;
      worker = await createWorker(ocrLanguage, 1, langPath ? { langPath } : {});
      await worker.setParameters({ tessedit_pageseg_mode: ocrLayoutMode as any, preserve_interword_spaces: "1", user_defined_dpi: "300", textord_tabfind_find_tables: "1" });
      for (let index = 0; index < targets.length; index += 1) {
        const page = targets[index];
        setStatus(`${t("scanRecognizing")} ${index + 1}/${targets.length}: ${page.file.name}`);
        const fullCanvas = await makeProcessedCanvas(page);
        let ocrCanvas: HTMLCanvasElement | null = null;
        try {
          const selectedRegion = target === "full" ? undefined : page.ocrRegion;
          const prepared = makeOcrCanvas(fullCanvas, selectedRegion, enhanceOcr, page.denoise, page.sharpen);
          ocrCanvas = prepared.canvas;
          const result = await worker.recognize(ocrCanvas);
          const words: WordBox[] = (result.data.words ?? []).map((word) => ({
            text: String(word.text ?? ""),
            x0: prepared.left + Number(word.bbox?.x0 ?? 0) / prepared.scale,
            y0: prepared.top + Number(word.bbox?.y0 ?? 0) / prepared.scale,
            x1: prepared.left + Number(word.bbox?.x1 ?? 0) / prepared.scale,
            y1: prepared.top + Number(word.bbox?.y1 ?? 0) / prepared.scale,
            confidence: Number(word.confidence ?? 0),
          })).filter((word) => word.text.trim() && [word.x0, word.y0, word.x1, word.y1, word.confidence].every(Number.isFinite));
          setPages((current) => current.map((item) => item.id === page.id ? { ...item, ocrText: result.data.text, words, confidence: Number(result.data.confidence ?? 0), ocrNeedsRefresh: false } : item));
        } finally {
          fullCanvas.width = 0;
          fullCanvas.height = 0;
          if (ocrCanvas) { ocrCanvas.width = 0; ocrCanvas.height = 0; }
        }
      }
      setStatus(target === "selected" ? t("scanSelectedOcrComplete") : target === "full" ? t("scanFullOcrComplete") : t("scanOcrComplete"));
    } catch {
      setError(t("scanOcrFailed"));
      setStatus("");
    } finally {
      if (worker) await worker.terminate();
      setBusy(false);
    }
  }

  async function copyText(value: string) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const temporary = document.createElement("textarea");
        temporary.value = value;
        temporary.style.position = "fixed";
        temporary.style.opacity = "0";
        document.body.appendChild(temporary);
        temporary.select();
        const copied = document.execCommand("copy");
        temporary.remove();
        if (!copied) throw new Error("copy_failed");
      }
      setStatus(t("scanCopySuccess"));
      setError("");
    } catch {
      setError(t("scanCopyFailed"));
    }
  }

  function getRecognizedTranscript(): string {
    return buildRecognizedTranscript(pages, lang === "fa" ? "fa" : "en");
  }

  function sendRecognizedText(target: "word" | "ai" | "translator") {
    if (!hasRecognizedText || busy) return;
    const base = safeBaseName(pages[0]?.file.name ?? "scanned-document");
    const text = getRecognizedTranscript();
    if (!text.trim()) return;
    if (target === "word") onSendToWord(`${base}-ocr.txt`, text);
    else if (target === "translator") onSendToTranslator(`${base}-ocr.txt`, text);
    else onSendToDocuments(`${base}-ocr.txt`, text);
  }

  async function downloadOutputs() {
    if (!pages.length || busy) return;
    setBusy(true);
    setError("");
    setStatus(t("scanBuildingOutputs"));
    try {
      const pdf = await PDFDocument.create();
      pdf.setTitle("Scanned document");
      const searchableFont = await pdf.embedFont(StandardFonts.Helvetica);
      for (let index = 0; index < pages.length; index += 1) {
        const scanPage = pages[index];
        setStatus(`${t("scanBuildingPage")} ${index + 1}/${pages.length}`);
        const canvas = await makeProcessedCanvas(scanPage);
        try {
          const jpeg = await canvasToJpeg(canvas);
          const embedded = await pdf.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
          const landscape = canvas.width > canvas.height * 1.12;
          const pageWidth = landscape ? 842 : 595;
          const pageHeight = landscape ? 595 : 842;
          const margin = 18;
          const maxWidth = pageWidth - margin * 2;
          const maxHeight = pageHeight - margin * 2;
          const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
          const drawWidth = canvas.width * scale;
          const drawHeight = canvas.height * scale;
          const drawX = (pageWidth - drawWidth) / 2;
          const drawY = (pageHeight - drawHeight) / 2;
          const target = pdf.addPage([pageWidth, pageHeight]);
          target.drawImage(embedded, { x: drawX, y: drawY, width: drawWidth, height: drawHeight });

          // Helvetica supports Latin glyphs only. Persian OCR is preserved in TXT/DOCX exports.
          for (const word of scanPage.words ?? []) {
            const value = word.text.trim();
            if (!value || !/^[\x20-\x7E]+$/.test(value)) continue;
            const boxWidth = Math.max(1, ((word.x1 - word.x0) / canvas.width) * drawWidth);
            const boxHeight = Math.max(1, ((word.y1 - word.y0) / canvas.height) * drawHeight);
            const fontSize = Math.max(3, Math.min(18, boxHeight));
            const x = Math.max(drawX, Math.min(drawX + drawWidth - 1, drawX + (word.x0 / canvas.width) * drawWidth));
            const y = Math.max(0, Math.min(pageHeight - fontSize, pageHeight - (drawY + (word.y1 / canvas.height) * drawHeight)));
            try {
              target.drawText(value, { x, y, size: fontSize, font: searchableFont, color: rgb(0, 0, 0), opacity: 0, maxWidth: Math.max(fontSize, boxWidth + fontSize * 0.25) });
            } catch { /* Ignore words that cannot be encoded by the built-in Latin font. */ }
          }
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
      const base = safeBaseName(pages[0].file.name);
      const pdfBytes = await pdf.save();
      downloadFile(new File([toOwnedArrayBuffer(pdfBytes)], `${base}-scanned.pdf`, { type: "application/pdf" }));
      if (allRecognized) {
        const transcript = getRecognizedTranscript();
        downloadFile(new File([transcript], `${base}-ocr.txt`, { type: "text/plain;charset=utf-8" }));
        const docxBytes = createDocx(pages, lang);
        downloadFile(new File([toOwnedArrayBuffer(docxBytes)], `${base}-ocr.docx`, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
      }
      setStatus(allRecognized ? t("scanDownloadsReady") : t("scanPdfReadyOnly"));
    } catch {
      setError(t("scanExportFailed"));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="scan-page">
      <section className="scan-intro">
        <div className="scan-intro-icon"><Icon name="scan" size={28} /></div>
        <div>
          <h2>{t("scanTitle")}</h2>
          <p>{t("scanIntro")}</p>
          <p className="scan-privacy"><Icon name="shield" size={15} />{t("scanPrivacy")}</p>
        </div>
      </section>

      <section className="scan-upload panel" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files); }}>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" multiple hidden onChange={(event) => event.target.files && void addFiles(event.target.files)} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(event) => event.target.files && void addFiles(event.target.files)} />
        <div className="scan-upload-copy">
          <Icon name="upload" size={30} />
          <strong>{t("scanUploadTitle")}</strong>
          <span>{t("scanUploadHint")}</span>
        </div>
        <div className="scan-upload-actions">
          <button className="primary" onClick={() => fileInput.current?.click()}><Icon name="plus" size={17} />{t("scanAddImages")}</button>
          <button onClick={() => cameraInput.current?.click()}><Icon name="device" size={17} />{t("scanUseCamera")}</button>
        </div>
        <p className="small muted">{(lang === "fa" ? `سقف پلن ${plan === "pro" ? "Pro" : "Free"}: ${MAX_PAGES} صفحه، ${Math.round(MAX_FILE_BYTES / 1048576)} مگابایت برای هر فایل و ${Math.round(MAX_TOTAL_BYTES / 1048576)} مگابایت مجموع.` : `${plan === "pro" ? "Pro" : "Free"} limits: ${MAX_PAGES} pages, ${Math.round(MAX_FILE_BYTES / 1048576)} MB per file, ${Math.round(MAX_TOTAL_BYTES / 1048576)} MB total.`)} {pages.length > 0 ? `${pages.length}/${MAX_PAGES} · ${(totalBytes / (1024 * 1024)).toFixed(1)} MB` : ""}</p>
      </section>

      {pages.length > 0 && (
        <>
          <section className="scan-toolbar panel scan-ocr-toolbar">
            <label className="field">
              <span>{t("scanOcrLanguage")}</span>
              <select value={ocrLanguage} disabled={busy} onChange={(event) => { setOcrLanguage(event.target.value); setPages((current) => current.map((page) => ({ ...page, ocrNeedsRefresh: page.ocrText !== undefined ? true : page.ocrNeedsRefresh }))); }}>
                <option value="fas+eng">{t("scanPersianEnglish")}</option>
                <option value="fas">{t("scanPersianOnly")}</option>
                <option value="eng">{t("scanEnglishOnly")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("scanLayoutMode")}</span>
              <select value={ocrLayoutMode} disabled={busy} onChange={(event) => { setOcrLayoutMode(event.target.value); setPages((current) => current.map((page) => ({ ...page, ocrNeedsRefresh: page.ocrText !== undefined ? true : page.ocrNeedsRefresh }))); }}>
                <option value="3">{t("scanLayoutAuto")}</option>
                <option value="6">{t("scanLayoutBlock")}</option>
                <option value="11">{t("scanLayoutSparse")}</option>
                <option value="7">{t("scanLayoutLine")}</option>
                <option value="8">{t("scanLayoutWord")}</option>
              </select>
            </label>
            <label className="check-field"><input type="checkbox" checked={enhanceOcr} disabled={busy} onChange={(event) => { setEnhanceOcr(event.target.checked); setPages((current) => current.map((page) => ({ ...page, ocrNeedsRefresh: page.ocrText !== undefined ? true : page.ocrNeedsRefresh }))); }} />{t("scanOcrEnhance")}</label>
            <div className="scan-toolbar-actions">
              <button onClick={() => void recognizePages("selected")} disabled={busy || !selected?.ocrRegion}><Icon name="scan" size={17} />{t("scanRecognizeSelected")}</button>
              <button onClick={() => void recognizePages("all")} disabled={busy}><Icon name="scan" size={17} />{busy ? t("working") : t("scanRecognize")}</button>
              <button onClick={() => void recognizePages("full")} disabled={busy}><Icon name="file-text" size={17} />{t("scanRecognizeFull")}</button>
              <button className="primary" onClick={() => void downloadOutputs()} disabled={busy}><Icon name="download" size={17} />{t("scanCreateOutputs")}</button>
            </div>
          </section>

          <section className="scan-workspace">
            <aside className="scan-page-list panel">
              <div className="scan-section-heading"><strong>{t("scanPages")}</strong><span className="small muted">{pages.length}</span></div>
              {pages.map((page, index) => (
                <article key={page.id} className={`scan-page-item ${selected?.id === page.id ? "active" : ""}`}>
                  <button className="scan-page-select" onClick={() => { setSelectedId(page.id); setPreviewZoom(1); }} aria-pressed={selected?.id === page.id}>
                    <img src={page.previewUrl} alt="" />
                    <span><b>{index + 1}. {page.file.name}</b><small>{page.ocrNeedsRefresh ? t("scanOcrNeedsRefresh") : page.ocrText !== undefined ? t("scanOcrDone") : t("scanNotRecognized")}</small></span>
                  </button>
                  <div className="scan-page-actions">
                    <button title={t("editorMoveUp")} aria-label={t("editorMoveUp")} disabled={index === 0 || busy} onClick={() => movePage(page.id, -1)}><Icon name="chevron-up" size={15} /></button>
                    <button title={t("editorMoveDown")} aria-label={t("editorMoveDown")} disabled={index === pages.length - 1 || busy} onClick={() => movePage(page.id, 1)}><Icon name="chevron-down" size={15} /></button>
                    <button title={t("scanRotate")} aria-label={t("scanRotate")} disabled={busy} onClick={() => updatePage(page.id, { rotation: (page.rotation + 90) % 360 })}><Icon name="rotate-cw" size={15} /></button>
                    <button title={t("remove")} aria-label={t("remove")} disabled={busy} onClick={() => removePage(page.id)}><Icon name="trash" size={15} /></button>
                  </div>
                </article>
              ))}
            </aside>

            {selected && (
              <section className="scan-detail panel">
                <div className="scan-section-heading">
                  <strong>{t("scanPreview")}</strong>
                  <span className="small muted">{selected.file.name}</span>
                </div>
                <div className="scan-preview" ref={previewViewport}>
                  <div className={`scan-preview-frame ${selectingRegion ? "selecting" : ""} ${previewZoom > 1 ? "is-zoomed" : ""}`} style={{ width: `${previewZoom * 100}%`, maxWidth: "none" }}>
                    <canvas ref={previewCanvas} aria-label={t("scanPreviewAlt")} style={{ width: "100%", maxWidth: "none", maxHeight: "none" }} />
                    <div className="scan-region-layer" onPointerDown={(event) => selectingRegion ? beginRegionSelection(event) : beginPreviewPan(event)} onPointerMove={(event) => { if (regionGesture.current) moveRegionSelection(event); else movePreviewPan(event); }} onPointerUp={(event) => { if (regionGesture.current) finishRegionSelection(event); finishPreviewPan(); }} onPointerCancel={() => { regionGesture.current = null; panGesture.current = null; setDraftRegion(null); }}>
                      {(() => {
                        const region = draftRegion ?? selected.ocrRegion;
                        return region ? <div className={`scan-region-box ${selectingRegion ? "is-locked" : "is-editable"}`} style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} onPointerDown={beginRegionMove}>
                          {!selectingRegion && (["nw", "ne", "sw", "se"] as RegionHandle[]).map((handle) => <button type="button" key={handle} className={`scan-region-handle handle-${handle}`} aria-label={t("scanResizeRegion")} onPointerDown={(event) => beginRegionResize(event, handle)} />)}
                        </div> : null;
                      })()}
                    </div>
                  </div>
                </div>
                <div className="scan-zoom-controls">
                  <span>{t("scanZoom")}</span>
                  <button type="button" disabled={previewZoom <= 0.75} onClick={() => setPreviewZoom((value) => Math.max(0.75, Number((value - 0.25).toFixed(2))))}>−</button>
                  <strong>{Math.round(previewZoom * 100)}%</strong>
                  <button type="button" disabled={previewZoom >= 3} onClick={() => setPreviewZoom((value) => Math.min(3, Number((value + 0.25).toFixed(2))))}>+</button>
                  <button type="button" className="quiet" onClick={() => setPreviewZoom(1)}>{t("scanZoomReset")}</button>
                </div>
                <div className="scan-region-controls">
                  <div className="scan-region-actions">
                    <button className={selectingRegion ? "primary" : ""} disabled={busy} onClick={() => { setSelectingRegion((value) => !value); setDraftRegion(null); regionGesture.current = null; }}><Icon name="scan" size={16} />{selectingRegion ? t("scanCancelRegion") : t("scanSelectRegion")}</button>
                    <button disabled={busy || !selected.ocrRegion} onClick={() => setReadingRegion(undefined)}>{t("scanClearRegion")}</button>
                  </div>
                  <label className="check-field"><input type="checkbox" checked={applyRegionToAll} disabled={busy} onChange={(event) => { const checked = event.target.checked; setApplyRegionToAll(checked); if (checked) { setPages((current) => current.map((page) => ({ ...page, ocrRegion: selected.ocrRegion, ocrNeedsRefresh: page.ocrText !== undefined ? true : page.ocrNeedsRefresh }))); } }} />{t("scanApplyRegionAll")}</label>
                  <p className="small muted">{selectingRegion ? t("scanRegionDrawHint") : selected.ocrRegion ? t("scanRegionActiveHint") : t("scanRegionFullHint")}</p>
                </div>
                <div className="scan-adjustments scan-image-controls">
                  <label className="field">
                    <span>{t("scanImageMode")}</span>
                    <select disabled={busy} value={selected.mode} onChange={(event) => updatePage(selected.id, { mode: event.target.value as ScanMode })}>
                      <option value="color">{t("scanColor")}</option>
                      <option value="gray">{t("scanGrayscale")}</option>
                      <option value="bw">{t("scanBlackWhite")}</option>
                    </select>
                  </label>
                  <label className="range-field"><span>{t("scanBrightness")} · {selected.brightness}%</span><input type="range" min="70" max="135" step="1" value={selected.brightness} disabled={busy} onChange={(event) => updatePage(selected.id, { brightness: Number(event.target.value) })}/></label>
                  <label className="range-field"><span>{t("scanContrast")} · {selected.contrast}%</span><input type="range" min="70" max="160" step="1" value={selected.contrast} disabled={busy} onChange={(event) => updatePage(selected.id, { contrast: Number(event.target.value) })}/></label>
                  <label className="check-field"><input type="checkbox" checked={selected.denoise} disabled={busy} onChange={(event) => updatePage(selected.id, { denoise: event.target.checked })}/>{t("scanDenoise")}</label>
                  <label className="check-field"><input type="checkbox" checked={selected.sharpen} disabled={busy} onChange={(event) => updatePage(selected.id, { sharpen: event.target.checked })}/>{t("scanSharpen")}</label>
                  <button disabled={busy} onClick={() => updatePage(selected.id, { rotation: (selected.rotation + 90) % 360 })}><Icon name="rotate-cw" size={16} />{t("scanRotate")}</button>
                </div>
                <label className="field scan-transcript">
                  <span>{t("scanExtractedText")}</span>
                  <textarea rows={9} dir={lang === "fa" ? "rtl" : "auto"} disabled={selected.ocrText === undefined || busy} placeholder={t("scanTranscriptPlaceholder")} value={selected.ocrText ?? ""} onChange={(event) => updatePage(selected.id, { ocrText: event.target.value })} />
                </label>
                <div className="scan-transcript-actions">
                  <button type="button" disabled={selected.ocrText === undefined || !selected.ocrText.trim()} onClick={() => void copyText(selected.ocrText ?? "") }><Icon name="copy" size={15}/>{t("scanCopyText")}</button>
                  <button type="button" disabled={!hasRecognizedText} onClick={() => void copyText(getRecognizedTranscript())}><Icon name="copy" size={15}/>{t("scanCopyAll")}</button>
                  <button type="button" disabled={selected.ocrText === undefined || busy} onClick={() => updatePage(selected.id, { ocrText: "", words: [], confidence: undefined, ocrNeedsRefresh: false })}><Icon name="trash" size={15}/>{t("scanClearText")}</button>
                </div>
                <p className="small muted">{t("scanCorrectionHint")}</p>
                {selected.ocrNeedsRefresh && <p className="scan-stale-note" role="status">{t("scanOcrNeedsRefreshHint")}</p>}
                {selected.confidence !== undefined && <p className="small muted">{t("scanConfidence")}: {Math.round(selected.confidence)}%</p>}
                {!!selected.words?.some((word) => word.confidence < 55) && <div className="scan-low-confidence"><strong>{t("scanReviewWords")}</strong><div>{selected.words.filter((word) => word.confidence < 55).slice(0, 12).map((word, index) => <span key={`${word.text}-${index}`} title={`${Math.round(word.confidence)}%`}>{word.text} · {Math.round(word.confidence)}%</span>)}</div></div>}
              </section>
            )}
          </section>
          <section className="scan-output-note panel">
            <Icon name="info" size={18} />
            <p>{t("scanSearchableNote")}</p>
          </section>
          {hasRecognizedText && <section className="scan-handoff panel">
            <div className="scan-handoff-copy">
              <span className="scan-handoff-icon"><Icon name="check" size={19} /></span>
              <div><strong>{lang === "fa" ? "متن اسکن‌شده آماده استفاده است" : "Your recognized text is ready"}</strong><small>{recognizedCount < pages.length ? (lang === "fa" ? `متن ${recognizedCount} صفحهٔ پردازش‌شده آماده است؛ فقط همین صفحه‌ها ارسال می‌شوند.` : `Text from ${recognizedCount} processed page(s) is ready; only those pages will be sent.`) : (lang === "fa" ? "بدون دانلود و بارگذاری دوباره، متن را به فضای کاری بعدی بفرستید." : "Continue with the recognized text without downloading and re-uploading it.")}</small></div>
            </div>
            <div className="scan-handoff-actions">
              <button className="primary" onClick={() => sendRecognizedText("word")} disabled={busy}><Icon name="word" size={16} />{lang === "fa" ? "ویرایش در Word" : "Edit in Word"}</button>
              <button onClick={() => sendRecognizedText("translator")} disabled={busy}><Icon name="languages" size={16} />{t("scanTranslateText")}</button>
              <button onClick={() => sendRecognizedText("ai")} disabled={busy}><Icon name="brain" size={16} />{lang === "fa" ? "تحلیل در هوش اسناد" : "Analyze in AI Documents"}</button>
            </div>
          </section>}
        </>
      )}

      {pages.length === 0 && (
        <div className="scan-empty">
          <Icon name="images" size={40} />
          <strong>{t("scanEmptyTitle")}</strong>
          <span>{t("scanEmptyHint")}</span>
        </div>
      )}

      {status && <p className="scan-status" role="status">{status}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
