import { describe, expect, it } from "vitest";
import {
  foldRoman,
  hasIndicScript,
  romanKey,
  transliterateIndic,
} from "@/lib/indicTransliteration";

describe("transliterateIndic", () => {
  it("applies the inherent vowel, matras, and the virama", () => {
    expect(transliterateIndic("कमल")).toBe("kamal"); // final schwa dropped
    expect(transliterateIndic("काम")).toBe("kaam"); // matra replaces inherent
    expect(transliterateIndic("क्या")).toBe("kyaa"); // virama strips it
  });

  it("reads the same offsets across all nine scripts", () => {
    // Every one of these is the letter at offset 0x15 in its block, and a
    // word-final consonant drops its inherent vowel.
    for (const letter of ["क", "ক", "ਕ", "ક", "କ", "க", "క", "ಕ", "ക"]) {
      expect(transliterateIndic(letter)).toBe("k");
    }
    // With a following letter the inherent vowel surfaces.
    expect(transliterateIndic("कम")).toBe("kam");
  });

  it("uses Bengali and Odia's o-inherent vowel", () => {
    expect(transliterateIndic("গর্ত")).toBe("gort");
    expect(transliterateIndic("কলম")).toBe("kolom");
    // ...but not for the a-inherent scripts.
    expect(transliterateIndic("कलम")).toBe("kalam");
  });

  it("drops the final schwa at a word boundary, not just end of string", () => {
    expect(transliterateIndic("सड़क पर")).toBe("sadak par");
  });

  it("passes Latin, digits and punctuation through untouched", () => {
    expect(transliterateIndic("road 42, गड्ढा")).toBe("road 42, gaddhaa");
  });

  it("renders anusvara as n and drops zero-width joiners", () => {
    expect(transliterateIndic("गुंडी")).toBe("gundii");
    expect(transliterateIndic("क‍म")).toBe("kam");
  });

  it("leaves text with no Indic characters alone", () => {
    expect(transliterateIndic("pothole on the road")).toBe("pothole on the road");
    expect(hasIndicScript("pothole")).toBe(false);
    expect(hasIndicScript("गड्ढा")).toBe(true);
  });
});

describe("foldRoman", () => {
  it("collapses aspirates, vowel length, and gemination", () => {
    expect(foldRoman("gaddha")).toBe(foldRoman("gadda"));
    expect(foldRoman("khadda")).toBe(foldRoman("kadda"));
    expect(foldRoman("paani")).toBe(foldRoman("pani"));
    expect(foldRoman("kooda")).toBe(foldRoman("kuda"));
  });

  it("absorbs Hindi schwa deletion", () => {
    expect(foldRoman("kachara")).toBe(foldRoman("kachra"));
  });

  it("treats v/w and z/j as interchangeable", () => {
    expect(foldRoman("pawan")).toBe(foldRoman("pavan"));
    expect(foldRoman("bazaar")).toBe(foldRoman("bajar"));
  });

  it("keeps short words intact rather than folding them to nothing", () => {
    expect(foldRoman("toa")).toBe("to");
    expect(foldRoman("na")).toBe("na");
  });
});

describe("romanKey", () => {
  // The whole point: native script and every plausible romanisation of the
  // same word have to land on one key.
  const families: Array<[string, string[]]> = [
    ["गड्ढा", ["gaddha", "gadda", "ghadda", "gaddhaa"]],
    ["खड्डा", ["khadda", "khaddaa", "kadda"]],
    ["कचरा", ["kachra", "kachara", "kacchra"]],
    ["कूड़ा", ["kooda", "kuda", "koodaa"]],
    ["குழி", ["kuzhi", "kuli", "kuzhee"]],
    ["గుంత", ["gunta", "guntha"]],
    ["ખાડો", ["khado", "khaado", "kado"]],
    ["ಗುಂಡಿ", ["gundi", "gundee", "gunddi"]],
    ["കുഴി", ["kuzhi"]],
    ["ਟੋਆ", ["toa", "toaa"]],
    ["ଗାତ", ["gata", "gaata"]],
    ["গর্ত", ["gorto", "gorta"]],
    ["सड़क", ["sadak", "sadhak", "saddak"]],
    ["नाली", ["naali", "nali"]],
  ];

  it.each(families)("%s matches its romanisations", (native, romanisations) => {
    const key = romanKey(native);
    expect(key.length).toBeGreaterThan(0);
    for (const roman of romanisations) {
      expect(romanKey(roman)).toBe(key);
    }
  });

  it("does not collapse genuinely different words together", () => {
    expect(romanKey("gaddha")).not.toBe(romanKey("kachra"));
    expect(romanKey("nali")).not.toBe(romanKey("bijli"));
    expect(romanKey("kutta")).not.toBe(romanKey("gunta"));
  });
});
