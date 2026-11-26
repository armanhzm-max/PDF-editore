import { pdfjs } from "./pdfjs";
import { getPlanLimits } from "./entitlements.js";
import type { Plan } from "./types";
import { hasExpectedFileSignature, resolveAcceptedMime } from "./file-signatures.js";

export const FILE_LIMITS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxFilesPerOperation: 50,
  maxImagePixelsPerFile: 32_000_000,
  maxTotalImagePixels: 80_000_000,
  maxPdfPages: 300,
  maxTotalPdfPages: 500,
} as const;


export async function validateFiles(files: File[], accepts: string[], multiple: boolean, maxPdfPages: number = FILE_LIMITS.maxPdfPages, plan: Plan = "free"): Promise<void> {
  const limits = getPlanLimits(plan).files;
  if (!files.length) throw new Error("no_files");
  if (!multiple && files.length > 1) throw new Error("too_many_files");
  if (files.length > limits.maxFilesPerOperation) throw new Error("too_many_files");
  const expectedTypes = files.map((file) => resolveAcceptedMime(file, accepts));
  if (expectedTypes.some((mime) => !mime)) throw new Error("unsupported_file");
  for (let index = 0; index < files.length; index += 1) {
    if (!(await hasExpectedFileSignature(files[index], expectedTypes[index]!))) throw new Error("unsupported_file");
  }
  if (files.some((file) => file.size > limits.maxFileBytes)) throw new Error("file_too_large");
  if (files.reduce((total, file) => total + file.size, 0) > limits.maxTotalBytes) throw new Error("batch_too_large");

  let totalPdfPages = 0;
  let totalImagePixels = 0;
  for (const file of files) {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      if (typeof createImageBitmap === "function") {
        try {
          const bitmap = await createImageBitmap(file);
          const pixels = bitmap.width * bitmap.height;
          const tooWide = bitmap.width > 16_384 || bitmap.height > 16_384;
          bitmap.close();
          if (tooWide || pixels > limits.maxImagePixelsPerFile) throw new Error("image_too_large");
          totalImagePixels += pixels;
          if (totalImagePixels > limits.maxTotalImagePixels) throw new Error("image_batch_too_large");
        } catch (error) {
          if (["image_too_large", "image_batch_too_large"].includes((error as Error).message)) throw error;
          throw new Error("invalid_image");
        }
      }
      continue;
    }
    const task = pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false });
    let pages = 0;
    try {
      const pdf = await task.promise;
      pages = pdf.numPages;
      await pdf.destroy();
    } catch {
      await task.destroy().catch(() => undefined);
      throw new Error("invalid_pdf");
    }
    const allowedPages = Math.min(maxPdfPages, limits.maxPdfPages);
    if (pages > allowedPages) throw new Error("too_many_pages");
    totalPdfPages += pages;
    if (totalPdfPages > limits.maxTotalPdfPages) throw new Error("too_many_total_pages");
  }
}
