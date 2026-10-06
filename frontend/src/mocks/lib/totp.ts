/**
 * RFC 6238 time-based one-time passwords for the mock layer — a real
 * implementation, not a fixed accepted code, so an actual authenticator app
 * works against the mock and the mock cannot be more permissive than the
 * backend (`app/domain/totp.py`). Both are checked against the RFC's own
 * test vectors.
 *
 * HMAC-SHA1, 30-second steps, 6 digits, one step of drift either side.
 * `crypto.subtle` needs a secure context: https, or http://localhost.
 */

export const STEP_SECONDS = 30;
export const DIGITS = 6;
export const WINDOW = 1;
const SECRET_BYTES = 20;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/=+$/, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new Error("Invalid base32 secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export function generateSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));
}

export function stepAt(unixMs: number): number {
  return Math.floor(unixMs / 1000 / STEP_SECONDS);
}

export async function codeForStep(
  secret: string,
  step: number,
  digits = DIGITS,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const counter = new ArrayBuffer(8);
  new DataView(counter).setBigUint64(0, BigInt(step));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = mac[mac.length - 1] & 0x0f;
  const value =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(value % 10 ** digits).padStart(digits, "0");
}

/** The code an authenticator app shows at `unixMs` (`offset` steps later or earlier). */
export function codeAt(secret: string, unixMs: number, offset = 0): Promise<string> {
  return codeForStep(secret, stepAt(unixMs) + offset);
}

/**
 * The step `code` is valid for, or null. Steps at or before `lastStep` are
 * refused, which is what stops a code used a moment ago being used again.
 */
export async function matchStep(
  secret: string,
  code: string,
  unixMs: number,
  lastStep: number,
): Promise<number | null> {
  if (!/^[0-9]{6}$/.test(code)) return null;
  const now = stepAt(unixMs);
  let matched: number | null = null;
  for (let step = now - WINDOW; step <= now + WINDOW; step++) {
    if ((await codeForStep(secret, step)) === code && step > lastStep) matched = step;
  }
  return matched;
}

export function otpauthUri(secret: string, account: string, issuer = "Kartavya"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
}
