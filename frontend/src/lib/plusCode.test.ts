import { describe, expect, it } from "vitest";
import { decodePlusCode, parsePlusCode } from "./plusCode";

// Bengaluru. The short form is what Google Maps shows while you are looking at
// the city; the full form is what the share sheet copies.
const FULL = "7J4VXMV5+8Q";
const SHORT = "XMV5+8Q";
const NEARBY = { lat: 12.97, lng: 77.59 };

describe("parsePlusCode", () => {
  it("recognises a full code", () => {
    expect(parsePlusCode(FULL)).toEqual({ code: FULL, locality: null, isFull: true });
  });

  it("recognises a short code and keeps the locality Google prints after it", () => {
    expect(parsePlusCode("XMV5+8Q Bengaluru, Karnataka")).toEqual({
      code: SHORT,
      locality: "Bengaluru, Karnataka",
      isFull: false,
    });
  });

  it("is case-insensitive, since codes are usually pasted", () => {
    expect(parsePlusCode("7j4vxmv5+8q")?.code).toBe(FULL);
  });

  it("lets anything without a plus sign fall through to place search", () => {
    for (const input of ["Cubbon Park", "12.9716, 77.5946", "", "MG Road"]) {
      expect(parsePlusCode(input), input).toBeNull();
    }
  });

  it("rejects things that merely contain a plus sign", () => {
    for (const input of ["a+b", "++", "1+1", "XMV5+8Q+extra"]) {
      expect(parsePlusCode(input), input).toBeNull();
    }
  });
});

describe("decodePlusCode", () => {
  it("decodes a full code offline, with no reference point", () => {
    const point = decodePlusCode(parsePlusCode(FULL)!, null);
    expect(point).not.toBeNull();
    expect(point!.lat).toBeCloseTo(12.9933, 3);
    expect(point!.lng).toBeCloseTo(77.6594, 3);
  });

  it("recovers a short code against a nearby reference", () => {
    const point = decodePlusCode(parsePlusCode(SHORT)!, NEARBY);
    const full = decodePlusCode(parsePlusCode(FULL)!, null);
    expect(point).toEqual(full);
  });

  it("returns null for a short code with no reference rather than guessing", () => {
    // Defaulting to (0,0) or the map centre would drop the pin somewhere
    // plausible-looking and wrong.
    expect(decodePlusCode(parsePlusCode(SHORT)!, null)).toBeNull();
  });

  it("recovers the NEAREST cell, so a distant reference resolves elsewhere", () => {
    // This is the property that makes the locality matter: the same short code
    // is a different place depending on where you are standing.
    const nearBengaluru = decodePlusCode(parsePlusCode(SHORT)!, NEARBY);
    const nearSydney = decodePlusCode(parsePlusCode(SHORT)!, { lat: -33.87, lng: 151.21 });
    expect(nearBengaluru).not.toBeNull();
    expect(nearSydney).not.toBeNull();
    expect(nearSydney).not.toEqual(nearBengaluru);
  });
});
