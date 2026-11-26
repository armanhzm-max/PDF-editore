import { PDFDocument } from "pdf-lib";
import { pdfjs } from "../../core/pdfjs";
import type { Tool } from "../../core/types";
import { toOwnedArrayBuffer } from "../../core/bytes";

const Q: Record<string, { scale: number; jpeg: number }> = {
  low: { scale: 1, jpeg: 0.5 }, medium: { scale: 1.5, jpeg: 0.7 }, high: { scale: 2, jpeg: 0.85 },
};

// فشرده‌سازی با رندر صفحات به JPEG: حجم کم می‌شود ولی متن دیگر قابل انتخاب نیست
const tool: Tool = {
  id: "pdf-compress",
  name: { fa: "فشرده‌سازی PDF", en: "Compress PDF" },
  description: { fa: "حجم PDF را کم می‌کند (صفحات به تصویر تبدیل می‌شوند).", en: "Reduce PDF size (pages are rasterized; text becomes non-selectable)." },
  category: "pdf", accepts: ["application/pdf"], multiple: true, plan: "free", maxFilesFree: 1, maxFilesPro: 20, maxPdfPages: 100, maxPdfPagesPro: 300, usesAI: false,
  options: [{ key: "quality", label: { fa: "کیفیت", en: "Quality" }, default: "medium", choices: ["low", "medium", "high"] }],
  async run(files, { options }) {
    const q = Q[options.quality] ?? Q.medium;
    const out: File[] = [];
    for (const f of files) {
      const src = await pdfjs.getDocument({ data: await f.arrayBuffer(), isEvalSupported: false }).promise;
      try {
        const doc = await PDFDocument.create();
        for (let i = 1; i <= src.numPages; i++) {
          const page = await src.getPage(i);
          const vp = page.getViewport({ scale: q.scale });
          if (!Number.isFinite(vp.width * vp.height) || vp.width > 16_384 || vp.height > 16_384 || vp.width * vp.height > 32_000_000) throw new Error("page_too_large");
          const canvas = document.createElement("canvas");
          try {
            canvas.width = vp.width; canvas.height = vp.height;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("canvas_unavailable");
            await page.render({ canvasContext: context, viewport: vp }).promise;
            const blob: Blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("compression_failed")), "image/jpeg", q.jpeg));
            const img = await doc.embedJpg(await blob.arrayBuffer());
            const base = page.getViewport({ scale: 1 });
            doc.addPage([base.width, base.height]).drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
          } finally {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
        const bytes = await doc.save();
        out.push(bytes.length < f.size ? new File([toOwnedArrayBuffer(bytes)], f.name.replace(/\.pdf$/i, "-compressed.pdf"), { type: "application/pdf" }) : f);
      } finally {
        await src.destroy();
      }
    }
    return { files: out };
  },
};
export default tool;
