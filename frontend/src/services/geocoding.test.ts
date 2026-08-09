import { afterEach, describe, expect, it, vi } from "vitest";
import { searchPlaces } from "./geocoding";

const CUBBON_PARK = {
  place_id: 123,
  name: "Cubbon Park",
  display_name: "Cubbon Park, Sampangirama Nagar, Bengaluru, Karnataka, India",
  lat: "12.9742535",
  lon: "77.5921906",
  category: "leisure",
  type: "park",
  addresstype: "park",
};

function stubFetch(payload: unknown, ok = true) {
  const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(payload), {
      status: ok ? 200 : 500,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe("searchPlaces", () => {
  it("maps a Nominatim result into a PlaceResult with numeric coordinates", async () => {
    stubFetch([CUBBON_PARK]);
    const [place] = await searchPlaces("cubbon park");

    expect(place.name).toBe("Cubbon Park");
    expect(place.address).toContain("Sampangirama Nagar");
    // Strings in the API, numbers out — the map takes numbers.
    expect(place.lat).toBeCloseTo(12.9742535);
    expect(place.lng).toBeCloseTo(77.5921906);
  });

  it("labels the kind so same-named places can be told apart", async () => {
    // Two real "Cubbon Park" hits: the park itself and a railway stop.
    stubFetch([
      CUBBON_PARK,
      {
        ...CUBBON_PARK,
        place_id: 124,
        category: "railway",
        type: "stop",
        addresstype: "railway",
      },
    ]);
    const results = await searchPlaces("cubbon park");

    expect(results[0].kind).toBe("park");
    expect(results[1].kind).toBe("railway");
  });

  it("falls back to type, then category, when addresstype is absent", async () => {
    stubFetch([
      { ...CUBBON_PARK, addresstype: undefined },
      { ...CUBBON_PARK, place_id: 125, addresstype: undefined, type: undefined },
    ]);
    const results = await searchPlaces("cubbon");
    expect(results[0].kind).toBe("park");
    expect(results[1].kind).toBe("leisure");
  });

  it("falls back to the first line of the address when a result has no name", async () => {
    stubFetch([{ ...CUBBON_PARK, name: undefined }]);
    const [place] = await searchPlaces("cubbon");
    expect(place.name).toBe("Cubbon Park");
  });

  it("drops results with unusable coordinates rather than placing a NaN pin", async () => {
    stubFetch([{ ...CUBBON_PARK, lat: "not-a-number" }, CUBBON_PARK]);
    const results = await searchPlaces("cubbon");
    expect(results).toHaveLength(1);
  });

  it("returns an empty list when the service errors or answers with a non-array", async () => {
    stubFetch({ error: "rate limited" }, false);
    expect(await searchPlaces("anything")).toEqual([]);

    stubFetch({ unexpected: "shape" });
    expect(await searchPlaces("anything")).toEqual([]);
  });

  it("biases towards the current map centre without restricting to it", async () => {
    const spy = stubFetch([CUBBON_PARK]);
    await searchPlaces("park", { near: { lat: 12.97, lng: 77.59 } });

    const url = new URL(String(spy.mock.calls[0][0]));
    expect(url.searchParams.get("viewbox")).toBeTruthy();
    // `bounded=1` would hide every result outside the box — a preference, not a filter.
    expect(url.searchParams.get("bounded")).toBeNull();
  });

  it("never sends the Kartavya auth header to a third-party host", async () => {
    const spy = stubFetch([CUBBON_PARK]);
    await searchPlaces("park");

    const init = spy.mock.calls[0][1] ?? {};
    const headers = new Headers(init.headers ?? {});
    expect(headers.get("authorization")).toBeNull();
    expect(String(spy.mock.calls[0][0])).toContain("nominatim.openstreetmap.org");
  });
});
