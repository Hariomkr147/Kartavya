/**
 * Recognise a latitude/longitude pair typed or pasted into the map search box.
 *
 * Citizens and officers routinely have the exact point already — from a
 * WhatsApp location share, another map app, or a photo's EXIF read elsewhere —
 * and searching a place name for somewhere they can already name numerically
 * is a detour. If the input parses as coordinates there is also nothing to
 * geocode, so the caller can skip the network entirely.
 *
 * Deliberately strict: anything that does not cleanly parse as two in-range
 * numbers returns null and falls through to ordinary place search. "12, MG
 * Road" is an address, not a coordinate, and "100, 200" is a typo rather than
 * a point on Earth — treating either as a location would drop the pin
 * somewhere the user never asked for.
 *
 * Decimal degrees only. Degrees/minutes/seconds ("12°58'17.8\"N") is a
 * different grammar and is not accepted.
 */

export interface ParsedCoordinates {
  lat: number;
  lng: number;
}

/** One component: a signed decimal, an optional degree sign, an optional hemisphere letter. */
const COMPONENT = /^([+-]?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?$/i;

interface Component {
  value: number;
  hemisphere: "N" | "S" | "E" | "W" | null;
}

function parseComponent(token: string): Component | null {
  const match = COMPONENT.exec(token.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const hemisphere = match[2]
    ? (match[2].toUpperCase() as "N" | "S" | "E" | "W")
    : null;
  // A hemisphere letter carries the sign, so "12.97 S" and "-12.97" agree. If
  // a value is already signed the other way ("-12.97 S"), the letter wins as
  // the more explicit of the two.
  const signed =
    hemisphere === "S" || hemisphere === "W" ? -Math.abs(value) : hemisphere ? Math.abs(value) : value;
  return { value: signed, hemisphere };
}

export function parseCoordinates(input: string): ParsedCoordinates | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // A comma or semicolon separates when present; otherwise whitespace does.
  const tokens = /[,;]/.test(trimmed) ? trimmed.split(/[,;]/) : trimmed.split(/\s+/);
  if (tokens.length !== 2) return null;

  const first = parseComponent(tokens[0]);
  const second = parseComponent(tokens[1]);
  if (!first || !second) return null;

  let lat = first.value;
  let lng = second.value;

  // "77.59 E, 12.97 N" is longitude-first. Only swap on an explicit pair of
  // letters: with none, latitude-first is the near-universal convention, and
  // guessing from magnitude would silently mangle valid pairs.
  const firstIsLongitude = first.hemisphere === "E" || first.hemisphere === "W";
  const secondIsLatitude = second.hemisphere === "N" || second.hemisphere === "S";
  if (firstIsLongitude && secondIsLatitude) [lat, lng] = [lng, lat];

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Consistent, copy-pasteable rendering. 5dp is ~1 m — finer is false precision. */
export function formatCoordinates({ lat, lng }: ParsedCoordinates): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
