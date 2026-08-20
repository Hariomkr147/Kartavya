import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { changeLanguage } from "./index";
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  isSupportedLanguage,
  type Language,
} from "./languages";

/**
 * The active language plus a setter. `useTranslation` is what subscribes the
 * calling component to language changes, so this re-renders on a switch.
 */
export function useLanguage() {
  const { i18n } = useTranslation();
  const resolved = i18n.resolvedLanguage ?? i18n.language;
  const language: Language = isSupportedLanguage(resolved) ? resolved : DEFAULT_LANGUAGE;

  const setLanguage = useCallback((next: Language) => {
    void changeLanguage(next);
  }, []);

  return { language, setLanguage, languages: LANGUAGES };
}
