/**
 * Supported UI languages: English plus the five most-spoken Indian languages.
 *
 * `nativeName` is deliberately the endonym — a citizen scanning the language
 * picker is looking for their own script, not the English exonym — with
 * `englishName` kept alongside for `aria-label`s and search matching.
 */
export const LANGUAGES = [
  { code: "en", nativeName: "English", englishName: "English" },
  { code: "hi", nativeName: "हिन्दी", englishName: "Hindi" },
  { code: "bn", nativeName: "বাংলা", englishName: "Bengali" },
  { code: "mr", nativeName: "मराठी", englishName: "Marathi" },
  { code: "te", nativeName: "తెలుగు", englishName: "Telugu" },
  { code: "ta", nativeName: "தமிழ்", englishName: "Tamil" },
  { code: "pa", nativeName: "ਪੰਜਾਬੀ", englishName: "Punjabi" },
  { code: "gu", nativeName: "ગુજરાતી", englishName: "Gujarati" }
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as readonly Language[];

export const DEFAULT_LANGUAGE: Language = "en";

export const LANGUAGE_STORAGE_KEY = "kartavya-language";

export function isSupportedLanguage(value: unknown): value is Language {
  return (
    typeof value === "string" && (LANGUAGE_CODES as readonly string[]).includes(value)
  );
}

export function languageMeta(code: string) {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}
