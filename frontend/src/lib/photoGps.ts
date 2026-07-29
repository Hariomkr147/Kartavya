import { haversineMeters } from "@/lib/geo";
import type { ExifGps } from "@/lib/exifGps";

export interface PhotoGpsCandidate {
  /** Position in the citizen's current photo order, for pointing the UI at *which* photo a reading came from. */
  index: number;
  gps: ExifGps;
}

export type PhotoGpsResolution =
  | { status: "none" }
  | {
      status: "found";
      location: ExifGps;
      /** "single" when only one photo carried GPS — nothing to cross-check it against. "consensus" when two or more agreed. */
      source: "single" | "consensus";
      candidates: PhotoGpsCandidate[];
    }
  | { status: "inconsistent"; candidates: PhotoGpsCandidate[] };

/**
 * Same radius the backend uses to decide two complaints describe the same
 * physical issue (schema.dbml's ~50-100m cluster radius, mirrored in
 * mocks/lib/cluster.ts's CLUSTER_RADIUS_METERS) — reused here because it's
 * answering an analogous question: do these photos' GPS tags describe the
 * same spot?
 */
const NEARBY_THRESHOLD_METERS = 100;

function maxPairwiseDistanceMeters(points: ExifGps[]): number {
  let max = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const distance = haversineMeters(
        points[i].lat,
        points[i].lng,
        points[j].lat,
        points[j].lng,
      );
      if (distance > max) max = distance;
    }
  }
  return max;
}

function centroid(points: ExifGps[]): ExifGps {
  return {
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length,
  };
}

/**
 * Reconciles GPS readings from every currently-selected photo, not just the
 * first:
 *
 * - No photo has GPS → `none`; the citizen drops a pin manually.
 * - Exactly one does → that reading is used outright. There's nothing to
 *   cross-check a lone reading against, so requiring "consensus" here would
 *   just punish citizens who only have one geotagged photo.
 * - Two or more do → they must agree (within `NEARBY_THRESHOLD_METERS` of
 *   *every* other reading) before any of them is trusted automatically.
 *   Photos of the same civic issue taken moments apart shouldn't disagree by
 *   more than ordinary GPS noise; a real mismatch almost always means the
 *   wrong photo got attached, and silently picking one reading over another
 *   risks routing the complaint to the wrong zone. `inconsistent` surfaces
 *   that instead of guessing, alongside every reading so the UI can point at
 *   the specific photos involved.
 */
export function resolveGpsCandidates(candidates: PhotoGpsCandidate[]): PhotoGpsResolution {
  if (candidates.length === 0) return { status: "none" };
  if (candidates.length === 1) {
    return { status: "found", location: candidates[0].gps, source: "single", candidates };
  }
  const spread = maxPairwiseDistanceMeters(candidates.map((c) => c.gps));
  if (spread > NEARBY_THRESHOLD_METERS) {
    return { status: "inconsistent", candidates };
  }
  return {
    status: "found",
    location: centroid(candidates.map((c) => c.gps)),
    source: "consensus",
    candidates,
  };
}
