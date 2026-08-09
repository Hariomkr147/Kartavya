import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchPlaces, type PlaceResult } from "@/services/geocoding";

/** Below this, results are noise and the request is wasted. */
const MIN_QUERY_LENGTH = 3;
/** Nominatim's policy is ~1 request/second; one request per typing pause stays well inside it. */
const DEBOUNCE_MS = 550;

export interface UseGeocodeSearchResult {
  results: PlaceResult[];
  isSearching: boolean;
  /** True once a settled search returned nothing — drives "No places found". */
  isEmpty: boolean;
  failed: boolean;
}

/**
 * Debounced place search.
 *
 * The debounce is the rate limit: the query only reaches Nominatim after the
 * user stops typing, so a 20-character search costs one request rather than
 * twenty. Results are cached by query, so backspacing into a previous term is
 * free.
 */
export function useGeocodeSearch(
  query: string,
  options: { near?: { lat: number; lng: number } | null; enabled?: boolean } = {},
): UseGeocodeSearchResult {
  const { near = null, enabled = true } = options;
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const trimmed = query.trim();

  useEffect(() => {
    // Both branches go through a timer, including the clear: setting state
    // synchronously inside an effect triggers a cascading render (and trips
    // react-hooks/set-state-in-effect). Clearing is immediate-ish at 0ms;
    // only a real query waits out the debounce.
    const next = trimmed.length >= MIN_QUERY_LENGTH ? trimmed : "";
    const timer = setTimeout(() => setDebouncedQuery(next), next ? DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const active = enabled && debouncedQuery.length >= MIN_QUERY_LENGTH;

  // The bias point is deliberately NOT in the query key: re-searching because
  // the map drifted a few metres would multiply requests for no better answer.
  const { data, isFetching, isError, isSuccess } = useQuery({
    queryKey: ["geocode", debouncedQuery],
    queryFn: ({ signal }) => searchPlaces(debouncedQuery, { near, signal }),
    enabled: active,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return {
    results: data ?? [],
    // Typing counts as searching, so the spinner appears on the first
    // keystroke rather than only after the debounce elapses.
    isSearching:
      active && (isFetching || (trimmed !== debouncedQuery && trimmed.length >= MIN_QUERY_LENGTH)),
    isEmpty: active && isSuccess && !isFetching && (data?.length ?? 0) === 0,
    failed: active && isError,
  };
}
