import { TRANSLATION_PLAN_LIMITS } from "../../shared/translation-limits.js";
const MB = 1024 * 1024;
/** Product limits shown in the UI and applied before local browser processing.
 * They are usability/abuse limits, not tamper-proof security controls: documents
 * stay on the user's device and are intentionally not uploaded for enforcement.
 */
export const PLAN_LIMITS = {
    free: {
        files: { maxFileBytes: 25 * MB, maxTotalBytes: 50 * MB, maxFilesPerOperation: 10, maxPdfPages: 100, maxTotalPdfPages: 200, maxImagePixelsPerFile: 20_000_000, maxTotalImagePixels: 40_000_000 },
        tools: { batchFallback: 1, pdfMerge: 3, imagesToPdf: 5, imageConvert: 1, pdfCompress: 1, pdfSplit: 1, ocr: 1, pdfExtract: 1 },
        scan: { maxPages: 5, maxFileBytes: 25 * MB, maxTotalBytes: 50 * MB },
        pdfEditor: { maxPages: 50, maxFileBytes: 25 * MB },
        word: { maxFileBytes: 20 * MB, maxUncompressedBytes: 100 * MB, maxCharacters: 1_500_000 },
        excel: { maxFileBytes: 15 * MB, maxUncompressedBytes: 80 * MB, maxRows: 500, maxColumns: 100 },
        powerpoint: { maxFileBytes: 20 * MB, maxUncompressedBytes: 100 * MB, maxSlides: 30, maxTextPerSlide: 12_000 },
        workspace: { maxRecords: 10, maxRecordBytes: 2 * MB, maxTotalBytes: 15 * MB, maxBackupBytes: 25 * MB, fallbackBytes: 3.5 * MB },
        documents: { maxFiles: 3, maxFileBytes: 15 * MB, maxTotalBytes: 15 * MB, maxUncompressedBytes: 100 * MB, maxPdfPages: 100, maxContextChars: 24_000 },
        ai: { requestsPerDay: 3, assistantRequestsPerDay: 10 },
        translation: TRANSLATION_PLAN_LIMITS.free,
    },
    pro: {
        files: { maxFileBytes: 50 * MB, maxTotalBytes: 100 * MB, maxFilesPerOperation: 50, maxPdfPages: 300, maxTotalPdfPages: 500, maxImagePixelsPerFile: 32_000_000, maxTotalImagePixels: 80_000_000 },
        tools: { batchFallback: 20, pdfMerge: 30, imagesToPdf: 30, imageConvert: 20, pdfCompress: 20, pdfSplit: 20, ocr: 10, pdfExtract: 10 },
        scan: { maxPages: 20, maxFileBytes: 50 * MB, maxTotalBytes: 100 * MB },
        pdfEditor: { maxPages: 300, maxFileBytes: 50 * MB },
        word: { maxFileBytes: 40 * MB, maxUncompressedBytes: 200 * MB, maxCharacters: 4_000_000 },
        excel: { maxFileBytes: 30 * MB, maxUncompressedBytes: 160 * MB, maxRows: 5_000, maxColumns: 200 },
        powerpoint: { maxFileBytes: 50 * MB, maxUncompressedBytes: 200 * MB, maxSlides: 120, maxTextPerSlide: 24_000 },
        workspace: { maxRecords: 40, maxRecordBytes: 4 * MB, maxTotalBytes: 60 * MB, maxBackupBytes: 25 * MB, fallbackBytes: 3.5 * MB },
        documents: { maxFiles: 20, maxFileBytes: 50 * MB, maxTotalBytes: 60 * MB, maxUncompressedBytes: 200 * MB, maxPdfPages: 300, maxContextChars: 72_000 },
        ai: { requestsPerDay: 200, assistantRequestsPerDay: 300 },
        translation: TRANSLATION_PLAN_LIMITS.pro,
    },
};
export function getPlanLimits(plan) { return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free; }
export function getToolFileLimit(tool, plan) {
    const limits = getPlanLimits(plan).tools;
    const byId = {
        "pdf-merge": limits.pdfMerge,
        "images-to-pdf": limits.imagesToPdf,
        "image-convert": limits.imageConvert,
        "pdf-compress": limits.pdfCompress,
        "pdf-split": limits.pdfSplit,
    };
    return byId[tool.id] ?? (tool.multiple ? limits.batchFallback : 1);
}
export function planLabel(plan) { return plan === "pro" ? "Pro" : "Free"; }
