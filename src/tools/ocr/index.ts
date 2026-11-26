import { createWorker } from "tesseract.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { pdfjs } from "../../core/pdfjs";
import type { Tool } from "../../core/types";
import { toOwnedArrayBuffer } from "../../core/bytes";

// OCR کاملاً داخل مرورگر. داده زبان در اولین اجرا دانلود می‌شود؛
// برای سرعت و دسترسی در ایران، فایل‌های traineddata را خودتان میزبانی کنید و VITE_TESSDATA_URL را بگذارید.
const tool: Tool = {
  id: "ocr",
  name: { fa: "استخراج متن (OCR فارسی و انگلیسی)", en: "Extract text (OCR, Persian & English)" },
  description: { fa: "متن تصویر یا PDF اسکن‌شده را تشخیص می‌دهد؛ برای PDF لایه متن نامرئی انگلیسیِ قابل جست‌وجو نیز می‌سازد.", en: "Recognize scanned images and PDFs; for PDFs, also add an invisible searchable English text layer." },
  category: "image", accepts: ["image/png", "image/jpeg", "image/webp", "application/pdf"], multiple: false, plan: "free", maxFilesFree: 1, maxPdfPages: 30, maxPdfPagesPro: 100, usesAI: false,
  options: [{ key: "lang", label: { fa: "زبان", en: "Language" }, default: "fas+eng", choices: ["fas+eng", "fas", "eng"] }],
  async run(files, { options }) {
    const f = files[0];
    const langPath = import.meta.env.VITE_TESSDATA_URL as string | undefined;
    const worker = await createWorker(options.lang, 1, langPath ? { langPath } : {});
    try {
      let text = "";
      const outputFiles: File[] = [];
      const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
      const searchableDoc = isPdf ? await PDFDocument.load(await f.arrayBuffer()) : null;
      const searchableFont = searchableDoc && String(options.lang).includes("eng")
        ? await searchableDoc.embedFont(StandardFonts.Helvetica) : null;
      let searchableWordCount = 0;

      if (isPdf) {
        const pdf = await pdfjs.getDocument({ data: await f.arrayBuffer(), isEvalSupported: false }).promise;
        try {
          for (let i = 1; i <= Math.min(pdf.numPages, 100); i++) {
            const page = await pdf.getPage(i);
            const vp = page.getViewport({ scale: 2 });
            if (!Number.isFinite(vp.width * vp.height) || vp.width > 16_384 || vp.height > 16_384 || vp.width * vp.height > 32_000_000) throw new Error("page_too_large");
            const canvas = document.createElement("canvas");
            try {
              canvas.width = vp.width; canvas.height = vp.height;
              const context = canvas.getContext("2d");
              if (!context) throw new Error("canvas_unavailable");
              await page.render({ canvasContext: context, viewport: vp }).promise;
              const recognition = await worker.recognize(canvas);
              text += recognition.data.text + "\n\n";

              // Standard PDF fonts do not contain Persian glyphs. Keep Persian OCR in the TXT
              // output and add only encodable English words to the transparent searchable layer.
              if (searchableDoc && searchableFont) {
                const targetPage = searchableDoc.getPage(i - 1);
                const pageWidth = targetPage.getWidth();
                const pageHeight = targetPage.getHeight();
                for (const word of recognition.data.words ?? []) {
                  const value = String(word.text ?? "").trim();
                  if (!value || !/^[\x20-\x7E]+$/.test(value)) continue;
                  const box = word.bbox;
                  if (!box || ![box.x0, box.y0, box.x1, box.y1].every(Number.isFinite)) continue;
                  const scaleX = pageWidth / vp.width;
                  const scaleY = pageHeight / vp.height;
                  const fontSize = Math.max(4, Math.min(30, (box.y1 - box.y0) * scaleY));
                  const x = Math.max(0, Math.min(pageWidth - 1, box.x0 * scaleX));
                  const y = Math.max(0, Math.min(pageHeight - fontSize, pageHeight - box.y1 * scaleY));
                  try {
                    targetPage.drawText(value, {
                      x, y, size: fontSize, font: searchableFont,
                      color: rgb(0, 0, 0), opacity: 0, maxWidth: Math.max(fontSize, (box.x1 - box.x0) * scaleX + fontSize),
                    });
                    searchableWordCount++;
                  } catch { /* Skip OCR glyphs that the standard PDF font cannot encode. */ }
                }
              }
            } finally {
              canvas.width = 0;
              canvas.height = 0;
            }
          }
        } finally {
          await pdf.destroy();
        }
      } else {
        text = (await worker.recognize(f)).data.text;
      }
      const baseName = f.name.replace(/\.[^.]+$/, "");
      outputFiles.push(new File([text], baseName + ".txt", { type: "text/plain" }));
      if (searchableDoc && searchableWordCount > 0) {
        searchableDoc.setTitle(`${baseName} - searchable OCR`);
        const searchableBytes = await searchableDoc.save();
        outputFiles.push(new File([toOwnedArrayBuffer(searchableBytes)], baseName + "-searchable.pdf", { type: "application/pdf" }));
      }
      return { text, files: outputFiles };
    } finally {
      await worker.terminate();
    }
  },
};
export default tool;
