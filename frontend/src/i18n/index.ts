import i18n from "i18next";
import type { ParseKeys } from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_CODES,
  LANGUAGE_STORAGE_KEY,
  isSupportedLanguage,
  type Language,
} from "./languages";

export const NAMESPACE = "translation";

/**
 * Every key present in the English bundle. Modules that hold a key as data
 * rather than calling `t("literal")` (nav config, table column definitions,
 * ...) type it with this, so those keys are checked too.
 */
export type TranslationKey = ParseKeys;

/**
 * Only English ships in the main bundle; every other locale is a separate
 * chunk fetched the first time it is selected. With ten translated languages
 * and ~880 keys each, bundling them all would have added several hundred KB of
 * JSON that all but one language's users never read.
 */
const loaders: Record<Exclude<Language, "en">, () => Promise<{ default: object }>> = {
  hi: () => import("./locales/hi.json"),
  bn: () => import("./locales/bn.json"),
  mr: () => import("./locales/mr.json"),
  te: () => import("./locales/te.json"),
  ta: () => import("./locales/ta.json"),
  pa: () => import("./locales/pa.json"),
  gu: () => import("./locales/gu.json"),
  kn: () => import("./locales/kn.json"),
  ml: () => import("./locales/ml.json"),
  or: () => import("./locales/or.json"),
};

async function ensureBundle(lng: Language): Promise<void> {
  if (lng === DEFAULT_LANGUAGE || i18n.hasResourceBundle(lng, NAMESPACE)) return;
  const load = loaders[lng as Exclude<Language, "en">];
  if (!load) return;
  try {
    const mod = await load();
    i18n.addResourceBundle(lng, NAMESPACE, mod.default, true, true);
  } catch {
    // A failed locale chunk must not take the app down: i18next falls back to
    // English for every key, which is degraded but fully usable.
  }
}

/** Keeps assistive tech and CSS `:lang()` in sync with the active language. */
function syncDocumentLanguage(lng: string): void {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
}

export function detectedLanguage(value: string | undefined): Language {
  const languageOnly = value?.split("-")[0];
  return isSupportedLanguage(languageOnly) ? languageOnly : DEFAULT_LANGUAGE;
}

export async function initI18n(): Promise<typeof i18n> {
  if (i18n.isInitialized) return i18n;

  await i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: { en: { [NAMESPACE]: en } },
      ns: [NAMESPACE],
      defaultNS: NAMESPACE,
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: LANGUAGE_CODES as unknown as string[],
      // "hi-IN" and "hi" must resolve to the same bundle.
      load: "languageOnly",
      nonExplicitSupportedLngs: true,
      detection: {
        order: ["localStorage", "navigator"],
        lookupLocalStorage: LANGUAGE_STORAGE_KEY,
        caches: ["localStorage"],
      },
      interpolation: {
        // React already escapes interpolated values.
        escapeValue: false,
      },
      returnNull: false,
    });

  // `resolvedLanguage` is still the English fallback at this point when the
  // detector requested a locale whose lazy bundle has not been registered.
  // Load the requested language first, then ask i18next to resolve it again.
  const detected = detectedLanguage(i18n.language);
  await ensureBundle(detected);
  await i18n.changeLanguage(detected);
  syncDocumentLanguage(i18n.resolvedLanguage ?? DEFAULT_LANGUAGE);
  i18n.on("languageChanged", syncDocumentLanguage);

  return i18n;
}

/**
 * Switches language, fetching the locale chunk first so the UI never flashes
 * a frame of fallback English between the click and the translated render.
 */
export async function changeLanguage(lng: Language): Promise<void> {
  await ensureBundle(lng);
  await i18n.changeLanguage(lng);
}

export default i18n;
