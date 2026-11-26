import { PDFDocument } from "pdf-lib";
import type { Tool } from "../../core/types";
import { toOwnedArrayBuffer } from "../../core/bytes";

const tool: Tool = {
  id: "pdf-merge",
  name: { fa: "ادغام PDF", en: "Merge PDF" },
  description: { fa: "چند PDF را به یک فایل تبدیل می‌کند.", en: "Combine several PDFs into one file." },
  category: "pdf", accepts: ["application/pdf"], multiple: true, plan: "free", maxFilesFree: 3, maxFilesPro: 30, usesAI: false,
  async run(files) {
    const out = await PDFDocument.create();
    for (const f of files) {
      const src = await PDFDocument.load(await f.arrayBuffer());
      (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
    }
    return { files: [new File([toOwnedArrayBuffer(await out.save())], "merged.pdf", { type: "application/pdf" })] };
  },
};
export default tool;
