import { describe, expect, it } from "vitest";
import type { Category } from "@/types/api";
import { matchCategory, rankCategories } from "./categoryMatcher";

/**
 * The 12 seeded categories, in the order `GET /categories` returns them.
 * Order matters for the tie-break tests: the matcher must never resolve a tie
 * by picking whichever category happens to come first in this array.
 */
const CATEGORIES: Category[] = [
  ["cat_pothole", "POTHOLE", "Pothole", 72],
  ["cat_manhole", "OPEN_MANHOLE", "Open Manhole", 6],
  ["cat_light", "BROKEN_STREETLIGHT", "Broken Street Light", 24],
  ["cat_garbage", "GARBAGE_OVERFLOW", "Garbage Overflow", 48],
  ["cat_water", "WATER_LEAKAGE", "Water Leakage", 24],
  ["cat_drainage", "DRAINAGE_OVERFLOW", "Drainage Overflow", 12],
  ["cat_sewage", "SEWAGE_BLOCKAGE", "Sewage Blockage", 24],
  ["cat_footpath", "DAMAGED_FOOTPATH", "Damaged Footpath", 96],
  ["cat_tree", "FALLEN_TREE", "Fallen Tree or Branch", 12],
  ["cat_animal", "STRAY_ANIMAL", "Stray Animal Nuisance", 48],
  ["cat_dumping", "ILLEGAL_DUMPING", "Illegal Dumping", 48],
  ["cat_signal", "TRAFFIC_SIGNAL_FAULT", "Traffic Signal Malfunction", 24],
].map(([id, code, name, slaTargetHours]) => ({
  id: id as string,
  code: code as string,
  name: name as string,
  slaTargetHours: slaTargetHours as number,
}));

function match(description: string): string | null {
  return matchCategory(description, CATEGORIES)?.category.code ?? null;
}

describe("matchCategory — clear descriptions", () => {
  it.each([
    ["There is a deep pothole in the middle of the road", "POTHOLE"],
    ["street light not working, dark at night", "BROKEN_STREETLIGHT"],
    ["The manhole cover is missing near the bus stop", "OPEN_MANHOLE"],
    ["Overflowing garbage bin outside the school", "GARBAGE_OVERFLOW"],
    ["A pipe burst is wasting water on the main road", "WATER_LEAKAGE"],
    ["Waterlogging after every rain, the street is flooded", "DRAINAGE_OVERFLOW"],
    ["Construction debris dumped illegally on the corner plot", "ILLEGAL_DUMPING"],
    ["The traffic signal at the junction is not working", "TRAFFIC_SIGNAL_FAULT"],
    ["A large tree fell and is blocking the road", "FALLEN_TREE"],
    ["Broken footpath tiles near the market", "DAMAGED_FOOTPATH"],
    ["Aggressive stray dogs chasing children", "STRAY_ANIMAL"],
  ])("%s -> %s", (description, expected) => {
    expect(match(description)).toBe(expected);
  });
});

describe("matchCategory — non-English input", () => {
  it.each([
    ["sadak me gaddha hai bahut bada", "POTHOLE"],
    ["batti band hai, andhera hai raat ko", "BROKEN_STREETLIGHT"],
    ["kachra gadi nahi aayi, gandagi faili hai", "GARBAGE_OVERFLOW"],
    ["सड़क में गड्ढा है", "POTHOLE"],
    ["स्ट्रीट लाइट खराब है", "BROKEN_STREETLIGHT"],
    ["ரோட்டு குழி மிகவும் ஆபத்தானது", "POTHOLE"],
    ["చెత్త కుండీ నిండిపోయింది", "GARBAGE_OVERFLOW"],
  ])("%s -> %s", (description, expected) => {
    expect(match(description)).toBe(expected);
  });
});

describe("matchCategory — abstains rather than guessing", () => {
  it("returns null for an empty or whitespace description", () => {
    expect(match("")).toBeNull();
    expect(match("    ")).toBeNull();
  });

  it("returns null when nothing in the text is a category signal", () => {
    expect(match("Please look into this as soon as possible, thank you")).toBeNull();
  });

  it("does not fuzzy-match unrelated words that merely look similar", () => {
    // "rains" is within edit distance 2 of "rabies"; the old matcher
    // suggested Stray Animal Nuisance for a road complaint.
    expect(match("The road is in a terrible condition after the rains")).toBeNull();
  });

  it("abstains on a tie instead of taking whichever category is listed first", () => {
    // "drain" belongs to both OPEN_MANHOLE and DRAINAGE_OVERFLOW.
    const ranked = rankCategories("The drain is dirty", CATEGORIES);
    expect(ranked.length).toBeGreaterThan(1);
    expect(ranked[0].score).toBe(ranked[1].score);
    expect(match("The drain is dirty")).toBeNull();
  });

  it("gives the same answer whichever order the categories arrive in", () => {
    const reversed = [...CATEGORIES].reverse();
    for (const description of [
      "The drain is dirty",
      "gutter ke paas",
      "There is a deep pothole in the road",
    ]) {
      expect(matchCategory(description, reversed)?.category.code ?? null).toBe(
        match(description),
      );
    }
  });
});

describe("matchCategory — exact evidence outranks fuzzy evidence", () => {
  it("does not let a typo-distance hit beat a real keyword", () => {
    // "gutter" is within edit distance 2 of "litter" (GARBAGE_OVERFLOW).
    // The sewage reading must win: fuzzy only runs when nothing matched
    // exactly anywhere.
    expect(match("gutter se badbu aa rahi hai")).toBe("SEWAGE_BLOCKAGE");
  });

  it("still corrects genuine typos when there is no exact evidence at all", () => {
    expect(match("big pothol in the middle of the lane")).toBe("POTHOLE");
    expect(match("streetlgiht is broken")).toBe("BROKEN_STREETLIGHT");
  });
});

describe("matchCategory — negation", () => {
  it("ignores a negated mention and uses the rest of the sentence", () => {
    expect(match("There is no pothole here, the streetlight is broken")).toBe(
      "BROKEN_STREETLIGHT",
    );
  });

  it("does not let a negator reach past a clause boundary", () => {
    expect(match("no water leak, but the manhole cover is missing")).toBe(
      "OPEN_MANHOLE",
    );
  });

  it("does not negate a keyword that contains a negator of its own", () => {
    expect(match("light nahi jal rahi hai")).toBe("BROKEN_STREETLIGHT");
    expect(match("signal not working at the junction")).toBe("TRAFFIC_SIGNAL_FAULT");
  });
});

describe("scoring", () => {
  it("counts a word once even when several spellings of it are listed", () => {
    // "pothole" and "potholes" are both keywords; one word, one point.
    const [top] = rankCategories("pothole", CATEGORIES);
    expect(top.category.code).toBe("POTHOLE");
    expect(top.score).toBe(1);
  });

  it("weights a keyword shared between categories below a unique one", () => {
    const shared = rankCategories("gutter", CATEGORIES);
    const unique = rankCategories("manhole", CATEGORIES);
    expect(shared[0].score).toBeLessThan(unique[0].score);
  });

  it("accumulates independent evidence across a longer description", () => {
    const [top] = rankCategories(
      "street light not working, dark at night, the whole street is dark",
      CATEGORIES,
    );
    expect(top.category.code).toBe("BROKEN_STREETLIGHT");
    expect(top.score).toBeGreaterThan(3);
  });

  it("reports the keywords behind a suggestion so the UI can explain it", () => {
    const result = matchCategory("overflowing garbage bin", CATEGORIES);
    expect(result?.matchedKeywords.length).toBeGreaterThan(0);
    expect(result?.matchedKeywords).toContain("garbage");
  });
});

describe("category keying", () => {
  it("keys on the stable code, not the display name", () => {
    const renamed = CATEGORIES.map((c) =>
      c.code === "POTHOLE" ? { ...c, name: "Road Surface Defect" } : c,
    );
    expect(matchCategory("deep pothole in the road", renamed)?.category.code).toBe(
      "POTHOLE",
    );
  });

  it("falls back to the seeded display name when no code is present", () => {
    const codeless = CATEGORIES.map(({ code: _code, ...rest }) => rest as Category);
    expect(matchCategory("deep pothole in the road", codeless)?.category.name).toBe(
      "Pothole",
    );
  });

  it("ignores categories it has no lexicon for", () => {
    const unknown: Category[] = [
      { id: "cat_x", code: "SOMETHING_NEW", name: "Something New", slaTargetHours: 24 },
    ];
    expect(matchCategory("deep pothole in the road", unknown)).toBeNull();
  });
});

describe("matchCategory — romanised Indic input", () => {
  // The lexicon cannot list every way an Indian-language word gets typed in
  // Latin script, so these reach their category through the transliteration
  // fold rather than through a literal lexicon entry.
  it.each([
    ["yahan bahut bada ghadda hai", "POTHOLE"],
    ["sadak pe gadda", "POTHOLE"],
    ["raste madhe khadda aahe", "POTHOLE"],
    ["kacchra phaila hua hai", "GARBAGE_OVERFLOW"],
    ["kooda jama hai", "GARBAGE_OVERFLOW"],
    ["batti nahi jal rahi", "BROKEN_STREETLIGHT"],
  ])("%s -> %s", (description, expected) => {
    expect(match(description)).toBe(expected);
  });

  it.each([
    ["ਸੜਕ ਵਿੱਚ ਟੋਆ ਹੈ", "POTHOLE"],
    ["রাস্তায় গর্ত", "POTHOLE"],
    ["ರಸ್ತೆಯಲ್ಲಿ ಗುಂಡಿ", "POTHOLE"],
    ["రోడ్డులో గుంత", "POTHOLE"],
  ])("native script still resolves: %s -> %s", (description, expected) => {
    expect(match(description)).toBe(expected);
  });

  it("does not let a folded match outrank an exact one", () => {
    // "ghadda" is a real spelling but not a lexicon entry, so it can only be
    // reached through the fold. "garbage" is an exact hit, which means the
    // folded tier never runs at all — POTHOLE must not appear in the ranking,
    // let alone win it.
    const ranked = rankCategories("garbage dumped near the ghadda", CATEGORIES);
    expect(ranked[0].category.code).toBe("GARBAGE_OVERFLOW");
    expect(ranked.map((r) => r.category.code)).not.toContain("POTHOLE");
  });

  it("still abstains on text that means nothing to the lexicon", () => {
    expect(match("kuch bhi likh raha hoon yahan")).toBeNull();
  });
});
