import type en from "./locales/en.json";

/**
 * Types every `t("...")` call against the English bundle, so a typo or a key
 * deleted from en.json is a compile error rather than a raw key rendered to
 * a citizen.
 */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
  }
}
