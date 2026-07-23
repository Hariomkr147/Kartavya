interface NominatimAddress {
  amenity?: string;
  shop?: string;
  building?: string;
  road?: string;
  neighbourhood?: string;
  suburb?: string;
}

interface NominatimResponse {
  display_name?: string;
  address?: NominatimAddress;
}

const cache = new Map<string, string | null>();

// Nominatim's usage policy caps unauthenticated use at ~1 request/second —
// this queue serializes lookups across every feed card on the page instead
// of firing them all at once. Best-effort/demo-scale use of a free public
// service, not a production geocoding setup.
const MIN_GAP_MS = 1100;
let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function shortLabel(data: NominatimResponse): string | null {
  const address = data.address ?? {};
  const specific = address.amenity ?? address.shop ?? address.building;
  const street = address.road;
  const area = address.suburb ?? address.neighbourhood;
  const parts = [specific, street, area].filter((p): p is string => !!p);
  if (parts.length > 0) return parts.slice(0, 2).join(", ");
  if (data.display_name) return data.display_name.split(",").slice(0, 2).join(",").trim();
  return null;
}

async function fetchLandmark(lat: number, lng: number): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const data = (await response.json()) as NominatimResponse;
  return shortLabel(data);
}

/**
 * Best-effort nearby-landmark hint for a feed card, never throws. Caches by
 * rounded coordinates and serializes requests through a shared rate-limited
 * queue so a page of feed cards doesn't burst-call the free Nominatim API.
 */
export function reverseGeocodeLandmark(lat: number, lng: number): Promise<string | null> {
  const key = cacheKey(lat, lng);
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);

  const run = async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    try {
      const label = await fetchLandmark(lat, lng);
      cache.set(key, label);
      return label;
    } catch {
      cache.set(key, null);
      return null;
    }
  };

  const result = queue.then(run, run);
  queue = result;
  return result;
}
