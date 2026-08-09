/**
 * Plus codes (Open Location Code) in the map search box.
 *
 * Google Maps offers a plus code for every point and it is what people
 * actually share for somewhere with no address — precisely the places civic
 * complaints get filed. Nominatim does not resolve them (searching one returns
 * an empty list), so they are decoded locally against Google's reference
 * implementation rather than sent anywhere.
 *
 * Two forms, and the difference matters:
 *
 *   full   "7J4VXMV5+8Q"            self-contained; decodes offline, exactly.
 *   short  "XMV5+8Q Bengaluru"      missing its leading characters, so it only
 *                                   means anything relative to a reference
 *                                   point. Google prints the locality after it
 *                                   for exactly this reason.
 *
 * A short code recovers to the *nearest* matching cell, so the reference has
 * to be somewhere near the intended point. Getting that wrong lands the pin in
 * a different part of the world rather than failing, which is why the locality
 * is preferred over the map's current centre when one is given.
 */

import { OpenLocationCode } from "open-location-code";

const olc = new OpenLocationCode();

export interface ParsedPlusCode {
  /** The code itself, upper-cased. */
  code: string;
  /** Trailing text such as "Bengaluru, Karnataka", or null when absent. */
  locality: string | null;
  /** Full codes need no reference point; short ones do. */
  isFull: boolean;
}

export interface Point {
  lat: number;
  lng: number;
}

/**
 * Recognise a plus code, with any locality that follows it.
 *
 * Returns null for anything else so the caller falls through to ordinary place
 * search. Validation is delegated to the reference implementation rather than
 * a hand-rolled regex: the character set excludes vowels to avoid spelling
 * words, and the padding and separator rules are fiddly enough that an
 * approximate pattern would accept codes that do not decode.
 */
export function parsePlusCode(input: string): ParsedPlusCode | null {
  const trimmed = input.trim();
  if (!trimmed.includes("+")) return null;

  const [candidate, ...rest] = trimmed.split(/\s+/);
  const code = candidate.toUpperCase();
  if (!olc.isValid(code)) return null;

  const locality = rest.join(" ").trim();
  return {
    code,
    locality: locality.length > 0 ? locality : null,
    // isFull and isShort are not complements — isValid admits both, so ask
    // directly rather than inferring one from the other.
    isFull: olc.isFull(code),
  };
}

/**
 * Resolve a parsed code to a point, or null when it cannot be resolved yet.
 *
 * A short code with no usable reference returns null rather than guessing:
 * silently defaulting to (0, 0) or the map centre when the user named a
 * locality would drop the pin somewhere plausible-looking and wrong.
 */
export function decodePlusCode(
  parsed: ParsedPlusCode,
  reference: Point | null,
): Point | null {
  try {
    const full = parsed.isFull
      ? parsed.code
      : reference
        ? olc.recoverNearest(parsed.code, reference.lat, reference.lng)
        : null;
    if (!full) return null;

    const area = olc.decode(full);
    return { lat: area.latitudeCenter, lng: area.longitudeCenter };
  } catch {
    // The library throws on codes that pass isValid but cannot be decoded
    // (a short code handed to decode, a malformed recovery). A dropped pin is
    // worse than no pin, so every failure resolves to "not a location".
    return null;
  }
}
