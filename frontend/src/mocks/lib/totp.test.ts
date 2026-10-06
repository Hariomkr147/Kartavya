import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  codeForStep,
  matchStep,
  otpauthUri,
  stepAt,
} from "./totp";

// RFC 6238 Appendix B: the SHA-1 secret is the ASCII string "12345678901234567890".
const SECRET = base32Encode(new TextEncoder().encode("12345678901234567890"));

describe("mock TOTP — the same maths as app/domain/totp.py", () => {
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("RFC 6238 vector at t=%i", async (unix, expected) => {
    expect(await codeForStep(SECRET, stepAt(unix * 1000), 8)).toBe(expected);
  });

  it("six digits are the tail of the eight-digit code", async () => {
    expect(await codeForStep(SECRET, stepAt(59_000))).toBe("287082");
  });

  it("base32 round-trips", () => {
    const raw = Uint8Array.from({ length: 20 }, (_, i) => i * 7);
    expect(Array.from(base32Decode(base32Encode(raw)))).toEqual(Array.from(raw));
  });

  it("accepts one step either side, never two", async () => {
    const now = 1_000_000_000_000;
    const step = stepAt(now);
    for (const delta of [-1, 0, 1]) {
      expect(
        await matchStep(SECRET, await codeForStep(SECRET, step + delta), now, 0),
      ).toBe(step + delta);
    }
    expect(
      await matchStep(SECRET, await codeForStep(SECRET, step + 2), now, 0),
    ).toBeNull();
  });

  it("refuses a step that was already used", async () => {
    const now = 1_000_000_000_000;
    const step = stepAt(now);
    const code = await codeForStep(SECRET, step);
    expect(await matchStep(SECRET, code, now, step - 1)).toBe(step);
    expect(await matchStep(SECRET, code, now, step)).toBeNull();
  });

  it.each(["", "12345", "1234567", "12345a", "١٢٣٤٥٦"])(
    "rejects malformed %j",
    async (bad) => {
      expect(await matchStep(SECRET, bad, 1_000_000_000_000, 0)).toBeNull();
    },
  );

  it("escapes the otpauth label like the backend", () => {
    expect(otpauthUri("ABC", "asha+x@example.com")).toBe(
      "otpauth://totp/Kartavya:asha%2Bx%40example.com?secret=ABC&issuer=Kartavya",
    );
  });
});
