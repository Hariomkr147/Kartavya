import { describe, expect, it } from "vitest";
import {
  tessellatableZones,
  zoneHue,
  zoneLabelPosition,
  zoneVoronoiCells,
} from "./zoneVoronoi";
import type { Zone } from "@/types/api";

function zone(
  partial: Partial<Zone> & Pick<Zone, "id" | "centerLat" | "centerLng">,
): Zone {
  return {
    code: `Z-${partial.id}`,
    name: `Zone ${partial.id}`,
    isCatchAll: false,
    isActive: true,
    ...partial,
  };
}

const BOUNDS = { south: 12.8, west: 77.4, north: 13.2, east: 77.8 };

/** Haversine, the same rule `app/domain/geo.py` routes with. */
function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

function pointInRing(lat: number, lng: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    if (
      lngI > lng !== lngJ > lng &&
      lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI
    ) {
      inside = !inside;
    }
  }
  return inside;
}

describe("tessellatableZones", () => {
  it("drops the catch-all, whose centre is (0, 0) and not a place", () => {
    const zones = [
      zone({ id: "1", centerLat: 12.97, centerLng: 77.59 }),
      zone({ id: "2", centerLat: 0, centerLng: 0, isCatchAll: true }),
    ];
    expect(tessellatableZones(zones).map((z) => z.id)).toEqual(["1"]);
  });

  it("drops inactive zones, because routing does too", () => {
    const zones = [
      zone({ id: "1", centerLat: 12.97, centerLng: 77.59 }),
      zone({ id: "2", centerLat: 12.99, centerLng: 77.61, isActive: false }),
    ];
    expect(tessellatableZones(zones).map((z) => z.id)).toEqual(["1"]);
  });
});

describe("zoneVoronoiCells", () => {
  it("returns nothing when there is no boundary to draw", () => {
    expect(zoneVoronoiCells([], BOUNDS)).toEqual([]);
    expect(
      zoneVoronoiCells([zone({ id: "1", centerLat: 12.97, centerLng: 77.59 })], BOUNDS),
    ).toEqual([]);
  });

  it("gives every tessellatable zone exactly one cell", () => {
    const zones = [
      zone({ id: "1", centerLat: 12.95, centerLng: 77.55 }),
      zone({ id: "2", centerLat: 12.99, centerLng: 77.62 }),
      zone({ id: "3", centerLat: 13.05, centerLng: 77.5 }),
      zone({ id: "4", centerLat: 0, centerLng: 0, isCatchAll: true }),
    ];
    const cells = zoneVoronoiCells(zones, BOUNDS);
    expect(cells.map((c) => c.zone.id).sort()).toEqual(["1", "2", "3"]);
    for (const cell of cells) expect(cell.ring.length).toBeGreaterThan(2);
  });

  /**
   * The cells are only useful if they agree with the server. This walks a grid
   * over the viewport and checks that the cell a point falls inside always
   * belongs to the zone `nearest_active_zone` would have picked for it.
   */
  it("draws the same boundaries the backend routes by", () => {
    const zones = [
      zone({ id: "1", centerLat: 12.9, centerLng: 77.45 }),
      zone({ id: "2", centerLat: 12.97, centerLng: 77.6 }),
      zone({ id: "3", centerLat: 13.1, centerLng: 77.52 }),
      zone({ id: "4", centerLat: 13.05, centerLng: 77.75 }),
    ];
    const cells = zoneVoronoiCells(zones, BOUNDS);

    let checked = 0;
    for (let lat = 12.85; lat < 13.15; lat += 0.03) {
      for (let lng = 77.45; lng < 77.75; lng += 0.03) {
        const nearest = zones.reduce((best, z) =>
          haversineMeters(lat, lng, z.centerLat, z.centerLng) <
          haversineMeters(lat, lng, best.centerLat, best.centerLng)
            ? z
            : best,
        );
        const containing = cells.find((c) => pointInRing(lat, lng, c.ring));
        if (!containing) continue; // exactly on an edge; nothing to assert
        expect(containing.zone.id, `(${lat.toFixed(2)}, ${lng.toFixed(2)})`).toBe(
          nearest.id,
        );
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe("zoneHue", () => {
  it("is stable for a code and independent of the other zones", () => {
    expect(zoneHue("WARD-12-N")).toBe(zoneHue("WARD-12-N"));
    expect(zoneHue("WARD-12-N")).not.toBe(zoneHue("WARD-13-S"));
  });

  it("stays inside the hue wheel", () => {
    for (const code of ["A", "WARD-1", "zzz-999", "UNASSIGNED"]) {
      expect(zoneHue(code)).toBeGreaterThanOrEqual(0);
      expect(zoneHue(code)).toBeLessThan(360);
    }
  });
});

describe("zoneLabelPosition", () => {
  const VISIBLE = { south: 12.9, west: 77.5, north: 13.0, east: 77.6 };

  /** A ring covering far more than the viewport, as a real cell does. */
  const HUGE: [number, number][] = [
    [12.0, 77.0],
    [12.0, 78.0],
    [14.0, 78.0],
    [14.0, 77.0],
  ];

  it("keeps the label on screen when the cell engulfs the viewport", () => {
    const at = zoneLabelPosition(HUGE, VISIBLE);
    expect(at).not.toBeNull();
    const [lat, lng] = at!;
    expect(lat).toBeGreaterThanOrEqual(VISIBLE.south);
    expect(lat).toBeLessThanOrEqual(VISIBLE.north);
    expect(lng).toBeGreaterThanOrEqual(VISIBLE.west);
    expect(lng).toBeLessThanOrEqual(VISIBLE.east);
  });

  it("centres on the visible sliver when the cell only partly overlaps", () => {
    // Occupies the western third of the viewport and runs off to the west.
    const ring: [number, number][] = [
      [12.9, 77.3],
      [12.9, 77.53],
      [13.0, 77.53],
      [13.0, 77.3],
    ];
    const [, lng] = zoneLabelPosition(ring, VISIBLE)!;
    expect(lng).toBeGreaterThanOrEqual(VISIBLE.west);
    expect(lng).toBeLessThanOrEqual(77.53);
  });

  it("returns null when the cell is entirely off screen", () => {
    const ring: [number, number][] = [
      [11.0, 76.0],
      [11.0, 76.5],
      [11.5, 76.5],
      [11.5, 76.0],
    ];
    expect(zoneLabelPosition(ring, VISIBLE)).toBeNull();
  });

  it("still lands inside a cell smaller than the viewport", () => {
    const ring: [number, number][] = [
      [12.94, 77.54],
      [12.94, 77.56],
      [12.96, 77.56],
      [12.96, 77.54],
    ];
    const [lat, lng] = zoneLabelPosition(ring, VISIBLE)!;
    expect(lat).toBeCloseTo(12.95, 2);
    expect(lng).toBeCloseTo(77.55, 2);
  });
});
