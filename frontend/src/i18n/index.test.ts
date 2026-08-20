import { describe, expect, it } from "vitest";
import { detectedLanguage } from "./index";

describe("detectedLanguage", () => {
  it("normalizes regional browser locales to a supported language", () => {
    expect(detectedLanguage("hi-IN")).toBe("hi");
    expect(detectedLanguage("bn-BD")).toBe("bn");
  });

  it("falls back to English for missing or unsupported locales", () => {
    expect(detectedLanguage(undefined)).toBe("en");
    expect(detectedLanguage("fr-FR")).toBe("en");
  });
});
