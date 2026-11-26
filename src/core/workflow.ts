/** Short-lived, in-memory transfer between local document workspaces. */
export type TextHandoff = {
  id: string;
  name: string;
  text: string;
  source: "scan" | "word" | "ai" | "translator";
};

/** Build a transcript from pages that have OCR text, retaining original page numbers.
 * Unprocessed pages are omitted so a user can translate a selected page without
 * having to OCR every page in a multi-page scan first. Text is not normalized.
 */
export function buildRecognizedTranscript(
  pages: ReadonlyArray<{ ocrText?: string }>,
  language: "fa" | "en",
): string {
  const pageLabel = language === "fa" ? "صفحه" : "Page";
  return pages
    .flatMap((page, index) => page.ocrText === undefined
      ? []
      : [`--- ${pageLabel} ${index + 1} ---\n${page.ocrText}`])
    .join("\n\n");
}
