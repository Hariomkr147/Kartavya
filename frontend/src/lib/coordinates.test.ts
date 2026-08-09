import { describe, expect, it } from "vitest";
import { formatCoordinates, parseCoordinates } from "./coordinates";

describe("parseCoordinates", () => {
  it("accepts the separators people actually paste", () => {
    for (const input of [
      "11.70707, 70.3333",
      "11.70707,70.3333",
      "11.70707 70.3333",
      "  11.70707 ,  70.3333  ",
      "11.70707; 70.3333",
    ]) {
      expect(parseCoordinates(input), input).toEqual({ lat: 11.70707, lng: 70.3333 });
    }
  });

  it("handles negative and explicitly signed values", () => {
    expect(parseCoordinates("-33.8688, -151.2093")).toEqual({
      lat: -33.8688,
      lng: -151.2093,
    });
    expect(parseCoordinates("+12.9716, +77.5946")).toEqual({ lat: 12.9716, lng: 77.5946 });
  });

  it("reads degree signs and hemisphere letters, as copied from map apps", () => {
    expect(parseCoordinates("12.9716° N, 77.5946° E")).toEqual({
      lat: 12.9716,
      lng: 77.5946,
    });
    expect(parseCoordinates("33.8688 S, 151.2093 W")).toEqual({
      lat: -33.8688,
      lng: -151.2093,
    });
  });

  it("swaps a longitude-first pair only when the letters say so", () => {
    expect(parseCoordinates("77.5946 E, 12.9716 N")).toEqual({
      lat: 12.9716,
      lng: 77.5946,
    });
    // Without letters, latitude-first is assumed rather than inferred from
    // magnitude — silently reordering a valid pair would be worse than wrong.
    expect(parseCoordinates("77.5946, 12.9716")).toEqual({ lat: 77.5946, lng: 12.9716 });
  });

  it("rejects out-of-range values instead of dropping a pin nowhere", () => {
    expect(parseCoordinates("100, 200")).toBeNull();
    expect(parseCoordinates("-91, 0")).toBeNull();
    expect(parseCoordinates("0, 181")).toBeNull();
  });

  it("lets addresses and place names fall through to place search", () => {
    for (const input of [
      "12, MG Road",
      "Cubbon Park",
      "12.9716",
      "",
      "   ",
      "12.9716, 77.5946, 10",
      "abc, def",
      "12.9.7, 77",
    ]) {
      expect(parseCoordinates(input), input).toBeNull();
    }
  });

  it("accepts the exact boundaries", () => {
    expect(parseCoordinates("90, 180")).toEqual({ lat: 90, lng: 180 });
    expect(parseCoordinates("-90, -180")).toEqual({ lat: -90, lng: -180 });
  });
});

describe("formatCoordinates", () => {
  it("renders at ~1 m precision", () => {
    expect(formatCoordinates({ lat: 12.97162345, lng: 77.5946 })).toBe("12.97162, 77.59460");
  });
});
