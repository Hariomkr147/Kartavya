import { describe, expect, it } from "vitest";
// `?raw` rather than node:fs — the suite runs under jsdom, where
// `import.meta.url` is an http URL and cannot be resolved to a path.
import indexCss from "../index.css?raw";
import en from "./locales/en.json";
import { LANGUAGES, type Language } from "./languages";

/**
 * Adding a language is four edits in three files — the `LANGUAGES` row, the
 * lazy loader, the locale JSON, and the `html:lang()` font block. Missing any
 * one of them fails silently at runtime (English fallback, or tofu boxes for
 * a script the bundled fonts don't cover), so it is checked here instead.
 */

const bundles = import.meta.glob<{ default: Record<string, unknown> }>(
  "./locales/*.json",
  { eager: true },
);

/** Latin-script languages ride on the default body font, no override needed. */
const LATIN_SCRIPT: Language[] = ["en"];

function flatten(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k),
  );
}

function placeholders(value: unknown): string[] {
  return [...String(value).matchAll(/{{(.*?)}}/g)].map((m) => m[1].trim()).sort();
}

function lookup(bundle: Record<string, unknown>, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
      bundle,
    );
}

const englishKeys = flatten(en);

describe.each(LANGUAGES.map((l) => l.code).filter((c) => c !== "en"))(
  "locale %s",
  (code) => {
    const bundle = bundles[`./locales/${code}.json`]?.default;

    it("ships a locale file", () => {
      expect(bundle).toBeDefined();
    });

    it("covers exactly the English key set", () => {
      expect(flatten(bundle).sort()).toEqual([...englishKeys].sort());
    });

    it("keeps every interpolation placeholder", () => {
      for (const key of englishKeys) {
        expect(placeholders(lookup(bundle!, key)), key).toEqual(
          placeholders(lookup(en as Record<string, unknown>, key)),
        );
      }
    });
  },
);

describe("script fonts", () => {
  it.each(LANGUAGES.map((l) => l.code).filter((c) => !LATIN_SCRIPT.includes(c)))(
    "%s has an html:lang() font override",
    (code) => {
      expect(indexCss).toMatch(new RegExp(`html:lang\\(${code}\\)`));
    },
  );

  it("imports every font family the overrides reference", () => {
    const families = new Set(
      [...indexCss.matchAll(/--font-body:\s*"([^"]+)"/g)].map((m) => m[1]),
    );
    for (const family of families) {
      const pkg = family
        .replace(/ Variable$/, "")
        .toLowerCase()
        .replace(/\s+/g, "-");
      expect(indexCss, family).toContain(`@fontsource-variable/${pkg}/`);
    }
  });
});
