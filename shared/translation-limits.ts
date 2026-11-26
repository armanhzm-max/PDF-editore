/** Single source of truth for translation availability, limits and language codes.
 * Imported by both the browser UI (display only) and the Worker (authoritative enforcement).
 */
export const TRANSLATION_PLAN_LIMITS = {
  free: { requestsPerDay: 3, maxCharacters: 3_000 },
  pro: { requestsPerDay: 200, maxCharacters: 20_000 },
} as const;

export const TRANSLATION_LANGUAGE_CODES = [
  "fa", "en", "ar", "fr", "de", "es", "it", "tr", "ru", "zh", "ja",
] as const;

export type TranslationLanguageCode = (typeof TRANSLATION_LANGUAGE_CODES)[number];
