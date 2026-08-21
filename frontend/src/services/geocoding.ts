/**
 * Place search against OpenStreetMap's Nominatim.
 *
 * Deliberately NOT routed through `apiFetch`: that attaches the Kartavya
 * bearer token to every request, and this is a third-party host. A plain
 * `fetch` keeps the token where it belongs.
 *
 * Nothing here touches the Kartavya contract — geocoding produces a latitude
 * and longitude for the *client* to put in fields the contract already
 * defines, so there is no endpoint and no schema change behind this.
 *
 * ⚠ Nominatim's public instance is a free, donation-funded service with a
 * usage policy: roughly one request per second, no bulk geocoding, and
 * attribution wherever results are shown. `useGeocodeSearch` debounces and
 * enforces a minimum query length to stay inside that; if this ever outgrows
 * the public instance, swap the base URL for a self-hosted Nominatim or a
 * keyed provider — this module is the only thing that would change.
 */

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

export interface PlaceResult {
  /** Stable within a result set; Nominatim's own id for the matched object. */
  id: string;
  /** Short label, e.g. "Cubbon Park". Falls back to the first line of the address. */
  name: string;
  /** Full comma-separated address, e.g. "Cubbon Park, Sampangirama Nagar, …". */
  address: string;
  /** What kind of place this is, e.g. "park", "railway stop" — disambiguates same-named results. */
  kind: string | null;
  lat: number;
  lng: number;
}

interface NominatimResult {
  place_id?: number | string;
  osm_id?: number | string;
  name?: string;
  display_name?: string;
  lat?: string;
  lon?: string;
  category?: string;
  type?: string;
  addresstype?: string;
}

function toKind(raw: NominatimResult): string | null {
  // `addresstype` is Nominatim's own one-word summary and reads best: a park
  // comes back as "park", a station as "railway". Combining `category` and
  // `type` instead produces "leisure park", which is worse than either alone.
  const label = raw.addresstype || raw.type || raw.category;
  return label ? label.replace(/_/g, " ") : null;
}

export interface SearchPlacesOptions {
  /** Bias results towards what the user is currently looking at, without excluding others. */
  near?: { lat: number; lng: number } | null;
  limit?: number;
  signal?: AbortSignal;
}

/** Search places, addresses and landmarks. Returns [] rather than throwing on a bad response. */
export async function searchPlaces(
  query: string,
  { near, limit = 8, signal }: SearchPlacesOptions = {},
): Promise<PlaceResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: String(limit),
    addressdetails: "0",
  });

  if (near) {
    // A viewbox WITHOUT `bounded=1` is a preference, not a filter: nearby
    // matches sort first, but searching a city you are not looking at still
    // works. Roughly a half-degree box around the current centre.
    const d = 0.5;
    params.set(
      "viewbox",
      [near.lng - d, near.lat + d, near.lng + d, near.lat - d].join(","),
    );
  }

  const response = await fetch(`${NOMINATIM_SEARCH_URL}?${params}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return [];

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) return [];

  return (payload as NominatimResult[])
    .map((raw, index) => {
      const lat = Number(raw.lat);
      const lng = Number(raw.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const address = raw.display_name ?? raw.name ?? "";
      return {
        id: String(raw.place_id ?? raw.osm_id ?? `${lat},${lng},${index}`),
        name: raw.name || address.split(",")[0] || address,
        address,
        kind: toKind(raw),
        lat,
        lng,
      } satisfies PlaceResult;
    })
    .filter((result): result is PlaceResult => result !== null);
}
