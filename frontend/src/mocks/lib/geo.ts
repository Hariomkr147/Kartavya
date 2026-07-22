const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two lat/lng points, in metres. */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

interface HasCenter {
  centerLat: number;
  centerLng: number;
  isActive: boolean;
}

/**
 * Nearest-centroid zone matching (per schema.dbml's zones note): a location
 * belongs to whichever active zone's centre is closest. Deactivated zones are
 * excluded so /zones/suggest never pre-fills one that POST /complaints would
 * then reject.
 */
export function findNearestActiveZone<T extends HasCenter>(
  zones: T[],
  lat: number,
  lng: number,
): T | null {
  const active = zones.filter((z) => z.isActive);
  if (active.length === 0) return null;

  let nearest = active[0];
  let nearestDistance = haversineMeters(lat, lng, nearest.centerLat, nearest.centerLng);
  for (const zone of active.slice(1)) {
    const distance = haversineMeters(lat, lng, zone.centerLat, zone.centerLng);
    if (distance < nearestDistance) {
      nearest = zone;
      nearestDistance = distance;
    }
  }
  return nearest;
}
