/**
 * Lossy Indic → Latin transliteration, plus a fold that collapses the ways
 * people actually type Indian words in Latin script.
 *
 * Why this exists: `categoryMatcher`'s lexicon carries each term in English,
 * in a Hinglish romanisation, and in the native script. That is three hand-
 * maintained spellings per term, and it still misses, because there is no one
 * romanisation people agree on — गड्ढा gets typed gaddha, gadda, gaddah,
 * gadha, ghadda, and the Marathi/Kannada/Malayalam equivalents each have their
 * own spread. Enumerating that by hand across 12 categories and 9 scripts is
 * both enormous and permanently incomplete.
 *
 * So instead of more list entries, both sides get reduced to a common key: the
 * native-script keyword is transliterated, the citizen's typing is folded, and
 * the two are compared. One new Devanagari term now brings its whole romanised
 * family with it for free.
 *
 * ## How the transliteration works
 *
 * The nine Brahmi-derived blocks Unicode assigns to Indian scripts are
 * ISCII-aligned: the same *offset* within each block is the same phoneme. क
 * (Devanagari U+0915), ক (Bengali U+0995), ಕ (Kannada U+0C95) and க (Tamil
 * U+0B95) all sit at offset 0x15 and are all "ka". So one offset table serves
 * every script, rather than nine hand-written tables that would drift apart.
 * Scripts with a smaller inventory (Tamil has no separate aspirates) simply
 * never produce those code points, so their rows go unused rather than wrong.
 *
 * This is a matching aid, not a romanisation standard: no diacritics, no
 * attempt at ISO 15919 fidelity. It only has to be *consistent*, since both
 * sides of the comparison go through it.
 */

/** Start of each supported Unicode block, all 128 code points wide. */
const INDIC_BLOCK_STARTS = [
  0x0900, // Devanagari — Hindi, Marathi
  0x0980, // Bengali
  0x0a00, // Gurmukhi — Punjabi
  0x0a80, // Gujarati
  0x0b00, // Oriya
  0x0b80, // Tamil
  0x0c00, // Telugu
  0x0c80, // Kannada
  0x0d00, // Malayalam
];

/** Consonants, WITHOUT the inherent vowel — that is applied by the walker. */
const CONSONANTS: Record<number, string> = {
  0x15: "k",
  0x16: "kh",
  0x17: "g",
  0x18: "gh",
  0x19: "ng",
  0x1a: "ch",
  0x1b: "chh",
  0x1c: "j",
  0x1d: "jh",
  0x1e: "ny",
  0x1f: "t",
  0x20: "th",
  0x21: "d",
  0x22: "dh",
  0x23: "n",
  0x24: "t",
  0x25: "th",
  0x26: "d",
  0x27: "dh",
  0x28: "n",
  0x29: "n",
  0x2a: "p",
  0x2b: "ph",
  0x2c: "b",
  0x2d: "bh",
  0x2e: "m",
  0x2f: "y",
  0x30: "r",
  0x31: "r",
  0x32: "l",
  0x33: "l",
  0x34: "zh",
  0x35: "v",
  0x36: "sh",
  0x37: "sh",
  0x38: "s",
  0x39: "h",
  // Nukta-composed forms, used across Devanagari/Gurmukhi for loanwords.
  0x58: "k",
  0x59: "kh",
  0x5a: "g",
  0x5b: "z",
  0x5c: "r",
  0x5d: "rh",
  0x5e: "f",
  0x5f: "y",
  // Malayalam chillu — bare consonants with no inherent vowel of their own.
  0x7a: "n",
  0x7b: "n",
  0x7c: "r",
  0x7d: "l",
  0x7e: "l",
  0x7f: "k",
};

/** Independent vowel letters (word-initial position). */
const VOWELS: Record<number, string> = {
  0x05: "a",
  0x06: "aa",
  0x07: "i",
  0x08: "ii",
  0x09: "u",
  0x0a: "uu",
  0x0b: "ri",
  0x0c: "li",
  0x0d: "e",
  0x0e: "e",
  0x0f: "e",
  0x10: "ai",
  0x11: "o",
  0x12: "o",
  0x13: "o",
  0x14: "au",
};

/** Dependent vowel signs (matras) — these REPLACE a consonant's inherent "a". */
const MATRAS: Record<number, string> = {
  0x3e: "aa",
  0x3f: "i",
  0x40: "ii",
  0x41: "u",
  0x42: "uu",
  0x43: "ri",
  0x44: "ri",
  0x45: "e",
  0x46: "e",
  0x47: "e",
  0x48: "ai",
  0x49: "o",
  0x4a: "o",
  0x4b: "o",
  0x4c: "au",
  0x62: "li",
  0x63: "li",
};

const VIRAMA = 0x4d; // strips the inherent vowel
const NUKTA = 0x3c;
const ANUSVARA = new Set([0x01, 0x02]); // nasalisation
const VISARGA = 0x03;

const ZERO_WIDTH = /[‌‍]/g;

/**
 * The inherent vowel a bare consonant carries. It is "a" across most of the
 * family but "o" in Bengali and Odia — গর্ত is gorto, not garta — and getting
 * that wrong desynchronises every Bengali term from its romanisation.
 */
const INHERENT_O_BLOCKS = new Set([0x0980, 0x0b00]);

function blockStart(codePoint: number): number | null {
  for (const start of INDIC_BLOCK_STARTS) {
    if (codePoint >= start && codePoint < start + 0x80) return start;
  }
  return null;
}

function blockOffset(codePoint: number): number | null {
  const start = blockStart(codePoint);
  return start === null ? null : codePoint - start;
}

export function hasIndicScript(text: string): boolean {
  for (const ch of text) {
    if (blockOffset(ch.codePointAt(0)!) !== null) return true;
  }
  return false;
}

/**
 * Transliterate any mix of the nine supported scripts to Latin. Characters
 * outside those blocks (Latin, digits, spaces, punctuation) pass through, so
 * a mixed "road पर गड्ढा" string comes out usable.
 */
export function transliterateIndic(text: string): string {
  const chars = [...text.replace(ZERO_WIDTH, "")];
  const out: string[] = [];
  // A consonant is held back until we know whether a matra, a virama, or
  // nothing follows it — that is what decides its vowel.
  let pending: string | null = null;
  // The inherent vowel belonging to whatever consonant is currently pending —
  // remembered because the character that resolves it may be from a different
  // script (or not a script character at all).
  let inherentVowel = "a";

  // The vowel only belongs to a consonant that is actually waiting for one —
  // with nothing pending there is no inherent "a" to emit, and emitting one
  // anyway prefixes every string with a phantom vowel.
  const flush = (vowel: string) => {
    if (pending === null) return;
    out.push(pending + vowel);
    pending = null;
  };

  for (const ch of chars) {
    const code = ch.codePointAt(0)!;
    const offset = blockOffset(code);
    const start = blockStart(code);
    const inherent = start !== null && INHERENT_O_BLOCKS.has(start) ? "o" : "a";

    if (offset === null) {
      // A word boundary ends the word, so the same final-schwa rule as
      // end-of-string applies — "सड़क पर" is "sadak par", not "sadaka para".
      flush(/[\p{L}\p{N}]/u.test(ch) ? inherentVowel : "");
      out.push(ch);
      continue;
    }
    if (offset === NUKTA) continue; // already folded into the base consonant
    if (offset === VIRAMA) {
      flush("");
      continue;
    }
    if (ANUSVARA.has(offset)) {
      flush(inherent);
      out.push("n");
      continue;
    }
    if (offset === VISARGA) {
      flush(inherent);
      out.push("h");
      continue;
    }
    if (offset >= 0x66 && offset <= 0x6f) {
      flush(inherent);
      out.push(String(offset - 0x66));
      continue;
    }

    const matra = MATRAS[offset];
    if (matra !== undefined) {
      flush(matra);
      continue;
    }

    const vowel = VOWELS[offset];
    if (vowel !== undefined) {
      flush(inherent);
      out.push(vowel);
      continue;
    }

    const consonant = CONSONANTS[offset];
    if (consonant !== undefined) {
      flush(inherent);
      pending = consonant;
      inherentVowel = inherent;
      continue;
    }

    // Anything left in the block (rare signs, currency, headstroke marks)
    // carries no phonetic value worth guessing at.
    flush(inherent);
  }

  // A word-final consonant keeps no inherent vowel: सड़क is "sadak", not
  // "sadaka", and that final schwa is exactly where romanisations disagree.
  flush("");
  return out.join("");
}

/**
 * Collapse a Latin string to the form shared by its common misspellings.
 *
 * Each rule earns its place from how Indian-language words actually get typed:
 *
 *  - **Aspirates.** Nobody is consistent about the trailing h. gaddha/gadda,
 *    khadda/kadda, kachra/kachara — folding kh→k, dh→d, ch→c and friends
 *    makes those one key.
 *  - **Vowel length.** Latin has no long/short pair, so aa/a, ee/i, oo/u are
 *    all in free variation in the wild.
 *  - **Doubled letters.** Gemination is written or not, at random.
 *  - **Schwa deletion.** Hindi drops the inherent "a" between consonants in
 *    speech and people type what they say: कचरा transliterates to "kachara"
 *    but is typed "kachra". Dropping every "a" that sits between two
 *    consonants reconciles the two without discarding the other vowels.
 *
 * Lossy by design. `categoryMatcher` treats a roman-key hit as weaker evidence
 * than an exact one and still applies its score floor and runner-up margin, so
 * a collision costs a suggestion, never a misfile.
 */
export function foldRoman(text: string): string {
  let s = text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/[^a-z0-9\s]/g, "");

  // Aspirates and multi-letter clusters, longest first so "chh" is not eaten
  // by the "ch" rule.
  s = s
    .replace(/chh/g, "c")
    .replace(/ch/g, "c")
    .replace(/kh/g, "k")
    .replace(/gh/g, "g")
    .replace(/jh/g, "j")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/ph/g, "f")
    .replace(/bh/g, "b")
    .replace(/sh/g, "s")
    .replace(/zh/g, "l")
    .replace(/ng/g, "n")
    .replace(/ny/g, "n")
    .replace(/rh/g, "r");

  // Vowel length and the common spellings of each sound.
  s = s
    .replace(/aa+/g, "a")
    .replace(/ee+/g, "i")
    .replace(/ii+/g, "i")
    .replace(/oo+/g, "u")
    .replace(/uu+/g, "u")
    .replace(/ai/g, "e")
    .replace(/ay/g, "e")
    .replace(/au/g, "o")
    .replace(/ow/g, "o");

  // Consonants that swap freely in Indian romanisation.
  s = s.replace(/w/g, "v").replace(/z/g, "j").replace(/q/g, "k").replace(/x/g, "ks");

  // Schwa deletion: an "a" wedged between two consonants is optional in both
  // speech and typing.
  const CONSONANT = "bcdfgjklmnprstvy";
  let previous = "";
  while (previous !== s) {
    previous = s;
    s = s.replace(new RegExp(`([${CONSONANT}])a([${CONSONANT}])`, "g"), "$1$2");
  }

  // Gemination, written or not.
  s = s.replace(/(.)\1+/g, "$1");

  // A trailing vowel is the least stable part of any of these words: the
  // native script may or may not carry a final inherent vowel (Bengali গর্ত
  // "gorto" against Hindi सड़क "sadak"), and typists add or drop it freely
  // (gunta/gunt, kasa/kas). Dropped from words long enough to survive it.
  s = s
    .split(" ")
    .map((word) => (word.length > 2 ? word.replace(/[aeiou]$/, "") : word))
    .join(" ");

  return s.replace(/\s+/g, " ").trim();
}

/**
 * The comparison key: transliterate, then fold. Safe to call on Latin text
 * (transliteration is a no-op there) and on native script alike.
 */
export function romanKey(text: string): string {
  return foldRoman(transliterateIndic(text));
}
