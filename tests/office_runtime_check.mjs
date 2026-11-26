import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { unzipSync, strFromU8 } from "fflate";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const outputDir = resolve(root, "tests/.office-runtime-artifacts");
await mkdir(outputDir, { recursive: true });

function loadTsx(relativePath) {
  const file = resolve(root, relativePath);
  const source = require("node:fs").readFileSync(file, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: file,
  });
  const Module = require("node:module");
  const instance = new Module(file);
  instance.filename = file;
  instance.paths = Module._nodeModulePaths(dirname(file));
  instance._compile(compiled.outputText, file);
  return instance.exports;
}

const excel = loadTsx("src/ui/ExcelWorkspace.tsx");
const grid = [
  ["Item", "Price", "Qty", "Total"],
  ["Pen", "10", "2", "=B2*C2"],
  ["Book", "20", "3", "=B3*C3"],
  ["Grand total", "", "", "=SUM(D2:D3)"],
  ["Average", "", "", "=AVERAGE(B2:B3)"],
];
if (excel.evaluateCell(3, 3, grid) !== "80") throw new Error("Excel SUM/reference formula runtime check failed");
if (excel.evaluateCell(4, 3, grid) !== "15") throw new Error("Excel AVERAGE formula runtime check failed");
const circular = [["=SUM(A1:A2)"], ["5"]];
if (excel.evaluateCell(0, 0, circular) !== "#CIRCULAR!") throw new Error("Excel circular reference guard failed");
const xlsx = excel.xlsxBuild(grid, "Sales");
await writeFile(resolve(outputDir, "sample.xlsx"), Buffer.from(xlsx));
console.log("PASS: spreadsheet formulas, circular-reference protection and XLSX generation");

const ppt = loadTsx("src/ui/PowerPointWorkspace.tsx");
const samplePng = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPkqYhiYGBgYmBgYGBgAAAKRADig+O+iAAAAABJRU5ErkJggg==";
const slides = [
  { id: 1, title: "گزارش فروش", subtitle: "مروری بر عملکرد", body: "فروش ماهانه\nرشد ۲۰ درصدی", background: "102033", accent: "46D6BD", layout: "cover", notes: "یادداشت ارائه‌دهنده فارسی", titleSize: 40, bodySize: 22 },
  { id: 2, title: "نتیجه‌گیری", body: "ممنون از توجه شما", background: "FFFFFF", layout: "content", notes: "نکته پایانی" },
  { id: 3, title: "تصویر و متن", body: "متن کنار تصویر", background: "E8EFEA", layout: "imageText", imageData: samplePng, imageMime: "image/png", imageRatio: 1, notes: "منبع تصویر" },
];
const pptx = ppt.buildPptx(slides, true);
const pptArchive = unzipSync(pptx);
if (!pptArchive["ppt/notesSlides/notesSlide1.xml"] || !strFromU8(pptArchive["ppt/notesSlides/notesSlide1.xml"]).includes("یادداشت ارائه‌دهنده فارسی")) throw new Error("PPTX speaker notes were not embedded");
if (!pptArchive["ppt/media/image3.png"] || !strFromU8(pptArchive["ppt/slides/_rels/slide3.xml.rels"]).includes("relationships/image")) throw new Error("PPTX image was not embedded with a slide relationship");
const converted = ppt.documentToSlides("[report.pdf · Page 1]\nExecutive summary\nKey finding A\n[report.pdf · Page 2]\nResults\nKey finding B", "report.pdf", "PDF", 12, false);
if (converted.length < 3 || !converted.some((slide) => slide.source?.includes("Page 2")) || !converted[0].notes?.includes("locally")) throw new Error("Local document-to-slide conversion lost source provenance");
const sheetDeck = ppt.documentToSlides("[sales.xlsx · Revenue!A1] Product\n[sales.xlsx · Revenue!B1] Amount\n[sales.xlsx · Revenue!A2] Books\n[sales.xlsx · Revenue!B2] 125", "sales.xlsx", "XLSX", 12, false);
const sheetSlide = sheetDeck.find((slide) => slide.layout === "twoColumn");
if (!sheetSlide || !sheetSlide.title.includes("Revenue") || !sheetSlide.body.includes("A1\nB1") || !sheetSlide.body.includes("Product\nAmount") || !sheetSlide.notes?.includes("Revenue!A1")) throw new Error("XLSX-to-slides conversion did not create reference/value columns with provenance");
await writeFile(resolve(outputDir, "sample.pptx"), Buffer.from(pptx));
console.log("PASS: PowerPoint OOXML with Persian notes, embedded image, and local document-to-slide conversion");
