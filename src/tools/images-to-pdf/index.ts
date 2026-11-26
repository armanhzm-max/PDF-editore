import { PDFDocument } from "pdf-lib";
import type { Tool } from "../../core/types";
import { toOwnedArrayBuffer } from "../../core/bytes";

const tool: Tool = {
  id: "images-to-pdf",
  name: { fa: "تصاویر به PDF", en: "Images to PDF" },
  description: { fa: "چند تصویر را به ترتیب در یک PDF قرار می‌دهد.", en: "Put several images into one PDF, in order." },
  category: "image", accepts: ["image/png", "image/jpeg", "image/webp"], multiple: true, plan: "free", maxFilesFree: 5, maxFilesPro: 30, usesAI: false,
  async run(files) {
    const doc = await PDFDocument.create();
    for (const file of files) {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      try {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas_unavailable");
        context.drawImage(bitmap, 0, 0);
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((value) => value ? resolve(value) : reject(new Error("conversion_failed")), "image/jpeg", 0.92);
        });
        const image = await doc.embedJpg(await blob.arrayBuffer());
        const scale = Math.min(1, 595 / image.width, 842 / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        doc.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
      } finally {
        bitmap.close();
        canvas.width = 0;
        canvas.height = 0;
      }
    }
    return { files: [new File([toOwnedArrayBuffer(await doc.save())], "images.pdf", { type: "application/pdf" })] };
  },
};
export default tool;
