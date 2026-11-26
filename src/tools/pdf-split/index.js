import { PDFDocument } from "pdf-lib";
import { toOwnedArrayBuffer } from "../../core/bytes";
function parse(spec, n) {
    if (spec.trim() === "each")
        return Array.from({ length: n }, (_, i) => [i]);
    if (!spec.trim() || spec.length > 1000)
        throw new Error("bad_range");
    const parts = spec.split(",");
    if (parts.length > 50)
        throw new Error("output_limit");
    const ranges = parts.map((part) => {
        const tokens = part.trim().split("-");
        if (tokens.length > 2 || !tokens[0])
            throw new Error("bad_range");
        const start = Number(tokens[0]);
        const end = tokens.length === 2 ? Number(tokens[1]) : start;
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > n)
            throw new Error("bad_range");
        return Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
    });
    const totalCopiedPages = ranges.reduce((total, range) => total + range.length, 0);
    if (totalCopiedPages > 500)
        throw new Error("output_limit");
    return ranges;
}
const tool = {
    id: "pdf-split",
    name: { fa: "تقسیم PDF", en: "Split PDF" },
    description: { fa: "PDF را به بازه‌های صفحه یا تک‌تک صفحات تقسیم می‌کند.", en: "Split a PDF by page ranges or into single pages." },
    category: "pdf", accepts: ["application/pdf"], multiple: true, plan: "free", maxFilesFree: 1, maxFilesPro: 20, maxPdfPages: 50, maxPdfPagesPro: 300, usesAI: false,
    options: [{ key: "ranges", label: { fa: "بازه‌ها (مثلاً 1-3,5 یا each)", en: "Ranges (e.g. 1-3,5 or each)" }, default: "each" }],
    async run(files, { options }) {
        const out = [];
        let totalOutputPages = 0;
        for (const f of files) {
            const src = await PDFDocument.load(await f.arrayBuffer());
            const base = f.name.replace(/\.pdf$/i, "");
            const ranges = parse(options.ranges, src.getPageCount());
            const copiedPages = ranges.reduce((total, range) => total + range.length, 0);
            if (out.length + ranges.length > 200 || totalOutputPages + copiedPages > 500)
                throw new Error("output_limit");
            totalOutputPages += copiedPages;
            for (const [i, idx] of ranges.entries()) {
                const doc = await PDFDocument.create();
                (await doc.copyPages(src, idx)).forEach((p) => doc.addPage(p));
                out.push(new File([toOwnedArrayBuffer(await doc.save())], `${base}-${i + 1}.pdf`, { type: "application/pdf" }));
            }
        }
        return { files: out };
    },
};
export default tool;
