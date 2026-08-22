import { Delaunay } from "d3-delaunay";
import type { Zone } from "@/types/api";

export interface ZoneCell {
  zone: Zone;
  /** Ring of [lat, lng] points, ready for a Leaflet `<Polygon positions>`. */
  ring: [number, number][];
}

export interface LatLngBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Longitude degrees are shorter than latitude degrees everywhere but the
 * equator, by cos(latitude). The backend routes with haversine
 * (`app/domain/geo.py`), so a Voronoi computed on raw lat/lng would draw
 * boundaries a couple of percent off the ones the server actually uses — the
 * cells would disagree with reality near the edges, which is exactly where an
 * admin looks. Scaling longitude by cos(mean latitude) turns the local
 * sphere into a plane accurate enough that "nearest centre" means the same
 * thing in both, over a city-sized extent.
 */
function projectionScale(zones: Zone[]): number {
  const meanLat = zones.reduce((sum, z) => sum + z.centerLat, 0) / zones.length;
  return Math.cos((meanLat * Math.PI) / 180);
}

/**
 * The zones eligible to own a region of the map.
 *
 * Inactive zones are excluded because routing excludes them
 * (`nearest_active_zone`). The catch-all is excluded for a different reason:
 * it is active and it does take part in routing, but its centre is not a
 * place — it is seeded at (0, 0), in the Gulf of Guinea. Its true Voronoi
 * cell is thousands of kilometres from any city, so leaving it out changes
 * nothing about the drawn tessellation while keeping a degenerate centre out
 * of the triangulation.
 */
export function tessellatableZones(zones: Zone[]): Zone[] {
  return zones.filter((z) => z.isActive && !z.isCatchAll);
}

/**
 * Voronoi cells for a set of zones, clipped to `bounds`.
 *
 * Nearest-centroid routing means these cells *are* the zone boundaries: the
 * edge between two zones is the perpendicular bisector of their centres. No
 * polygon is stored anywhere — this derives them, the same way `severityLabel`
 * and `slaLabel` are derived rather than stored.
 *
 * Returns [] when fewer than two zones can be tessellated: one zone owns
 * everything (there is no boundary to draw), and none owns nothing.
 */
export function zoneVoronoiCells(zones: Zone[], bounds: LatLngBounds): ZoneCell[] {
  const eligible = tessellatableZones(zones);
  if (eligible.length < 2) return [];

  const scale = projectionScale(eligible);
  const points = eligible.flatMap((z) => [z.centerLng * scale, z.centerLat]);

  // d3-delaunay clips to this rectangle for us, so the cells always cover the
  // viewport exactly rather than running off to infinity.
  const clip: [number, number, number, number] = [
    bounds.west * scale,
    bounds.south,
    bounds.east * scale,
    bounds.north,
  ];

  // `new Delaunay(flat)` — NOT `Delaunay.from(flat)`, which would treat the
  // flat [x, y, x, y, …] array as 2N separate points.
  const voronoi = new Delaunay(Float64Array.from(points)).voronoi(clip);

  const cells: ZoneCell[] = [];
  eligible.forEach((zone, index) => {
    const polygon = voronoi.cellPolygon(index);
    if (!polygon) return; // A centre outside the clip rectangle has no cell.
    cells.push({
      zone,
      // Back out of the projection, and back to Leaflet's [lat, lng] order.
      ring: polygon.map(([x, y]) => [y, x / scale] as [number, number]),
    });
  });
  return cells;
}

/**
 * A stable colour per zone.
 *
 * Keyed on the zone's immutable `code`, not its position in the list or its
 * name: a zone must keep its colour when another is added, renamed, or
 * deactivated, or every cell on the map shifts hue for no reason the admin
 * can see. Golden-angle spacing keeps neighbouring hues far apart.
 */
export function zoneHue(zoneCode: string): number {
  let hash = 0;
  for (const char of zoneCode) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return (Math.abs(hash) * 137.508) % 360;
}

/**
 * Clip a ring to an axis-aligned rectangle (Sutherland–Hodgman).
 *
 * Cells are computed against a padded viewport so they do not stop at the
 * screen edge, which means most of a cell is usually off-screen. Anything
 * that needs a point *inside the visible part* of a zone — a label, most of
 * all — has to clip first.
 */
function clipRing(ring: [number, number][], bounds: LatLngBounds): [number, number][] {
  const edges: [
    (p: [number, number]) => boolean,
    (a: [number, number], b: [number, number]) => [number, number],
  ][] = [
    [(p) => p[0] >= bounds.south, (a, b) => lerpAt(a, b, 0, bounds.south)],
    [(p) => p[0] <= bounds.north, (a, b) => lerpAt(a, b, 0, bounds.north)],
    [(p) => p[1] >= bounds.west, (a, b) => lerpAt(a, b, 1, bounds.west)],
    [(p) => p[1] <= bounds.east, (a, b) => lerpAt(a, b, 1, bounds.east)],
  ];

  let output = ring;
  for (const [inside, intersect] of edges) {
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const current = input[i];
      const previous = input[(i + input.length - 1) % input.length];
      const currentIn = inside(current);
      const previousIn = inside(previous);
      if (currentIn) {
        if (!previousIn) output.push(intersect(previous, current));
        output.push(current);
      } else if (previousIn) {
        output.push(intersect(previous, current));
      }
    }
    if (output.length === 0) return [];
  }
  return output;
}

/** Where segment a→b crosses `value` on axis `axis` (0 = lat, 1 = lng). */
function lerpAt(
  a: [number, number],
  b: [number, number],
  axis: 0 | 1,
  value: number,
): [number, number] {
  const span = b[axis] - a[axis];
  const t = span === 0 ? 0 : (value - a[axis]) / span;
  const other = axis === 0 ? 1 : 0;
  const point: [number, number] = [0, 0];
  point[axis] = value;
  point[other] = a[other] + (b[other] - a[other]) * t;
  return point;
}

/** Area-weighted centroid of a ring; falls back to the mean for a degenerate one. */
function ringCentroid(ring: [number, number][]): [number, number] {
  let twiceArea = 0;
  let lat = 0;
  let lng = 0;
  for (let i = 0; i < ring.length; i++) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[(i + 1) % ring.length];
    const cross = lngI * latJ - lngJ * latI;
    twiceArea += cross;
    lng += (lngI + lngJ) * cross;
    lat += (latI + latJ) * cross;
  }
  if (twiceArea === 0) {
    const mean = ring.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
    return [mean[0] / ring.length, mean[1] / ring.length];
  }
  return [lat / (3 * twiceArea), lng / (3 * twiceArea)];
}

/**
 * Where to write a zone's name, given what is currently on screen.
 *
 * Placing it at the cell's own centroid puts the label off-screen as soon as
 * an admin zooms into a street, because one cell then covers the whole
 * viewport and its centre is far outside it — the zones lose their names at
 * exactly the zoom where "which zone am I looking at?" is hardest to answer.
 * Clipping to the visible rectangle first keeps the label on the part of the
 * cell the admin can actually see.
 *
 * Returns null when none of the cell is visible.
 */
export function zoneLabelPosition(
  ring: [number, number][],
  visible: LatLngBounds,
): [number, number] | null {
  const clipped = clipRing(ring, visible);
  if (clipped.length < 3) return null;
  return ringCentroid(clipped);
}
