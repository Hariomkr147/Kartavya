import { describe, it, expect } from "vitest";
import { resolveGpsCandidates, type PhotoGpsCandidate } from "@/lib/photoGps";
import { haversineMeters } from "@/lib/geo";

const BASE = { lat: 12.9716, lng: 77.5946 };

/** Offsets `base` north by roughly `meters` — precise enough for test fixtures, not for production use. */
function metersNorth(base: typeof BASE, meters: number) {
  return { lat: base.lat + meters / 111320, lng: base.lng };
}

describe("resolveGpsCandidates", () => {
  it("returns none when no photo has GPS", () => {
    expect(resolveGpsCandidates([])).toEqual({ status: "none" });
  });

  it("uses the single candidate outright when only one photo has GPS", () => {
    const candidates: PhotoGpsCandidate[] = [{ index: 1, gps: BASE }];
    expect(resolveGpsCandidates(candidates)).toEqual({
      status: "found",
      location: BASE,
      source: "single",
      candidates,
    });
  });

  it("averages agreeing candidates into a consensus location", () => {
    const a: PhotoGpsCandidate = { index: 0, gps: BASE };
    const b: PhotoGpsCandidate = { index: 2, gps: metersNorth(BASE, 20) }; // well within 100m
    const result = resolveGpsCandidates([a, b]);
    expect(result.status).toBe("found");
    if (result.status !== "found") throw new Error("expected found");
    expect(result.source).toBe("consensus");
    expect(result.location.lat).toBeCloseTo((a.gps.lat + b.gps.lat) / 2, 9);
    expect(result.location.lng).toBeCloseTo((a.gps.lng + b.gps.lng) / 2, 9);
    expect(result.candidates).toEqual([a, b]);
  });

  it("flags two disagreeing candidates as inconsistent", () => {
    const a: PhotoGpsCandidate = { index: 0, gps: BASE };
    const b: PhotoGpsCandidate = { index: 1, gps: metersNorth(BASE, 500) }; // well past 100m
    const result = resolveGpsCandidates([a, b]);
    expect(result).toEqual({ status: "inconsistent", candidates: [a, b] });
  });

  it("flags the whole set inconsistent if even one of three disagrees with the rest", () => {
    const a: PhotoGpsCandidate = { index: 0, gps: BASE };
    const b: PhotoGpsCandidate = { index: 1, gps: metersNorth(BASE, 10) };
    const c: PhotoGpsCandidate = { index: 2, gps: metersNorth(BASE, 800) }; // the outlier
    const result = resolveGpsCandidates([a, b, c]);
    expect(result.status).toBe("inconsistent");
  });

  it("accepts three photos that all agree with each other", () => {
    const a: PhotoGpsCandidate = { index: 0, gps: BASE };
    const b: PhotoGpsCandidate = { index: 1, gps: metersNorth(BASE, 15) };
    const c: PhotoGpsCandidate = { index: 2, gps: metersNorth(BASE, 30) };
    const result = resolveGpsCandidates([a, b, c]);
    expect(result.status).toBe("found");
    if (result.status !== "found") throw new Error("expected found");
    expect(result.source).toBe("consensus");
  });
});

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters(BASE.lat, BASE.lng, BASE.lat, BASE.lng)).toBe(0);
  });

  it("returns a positive distance that grows with separation", () => {
    const near = haversineMeters(BASE.lat, BASE.lng, metersNorth(BASE, 50).lat, BASE.lng);
    const far = haversineMeters(BASE.lat, BASE.lng, metersNorth(BASE, 500).lat, BASE.lng);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
  });
});
