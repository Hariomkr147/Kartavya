import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Crosshair, Loader2, MapPin, Search, X } from "lucide-react";
import { useGeocodeSearch } from "@/hooks/useGeocodeSearch";
import type { PlaceResult } from "@/services/geocoding";
import { cn } from "@/lib/utils";
import { formatCoordinates, parseCoordinates } from "@/lib/coordinates";
import { reverseGeocodeLandmark } from "@/lib/reverseGeocode";

export interface MapSearchBoxProps {
  onSelect: (place: PlaceResult) => void;
  /** Current map centre — biases results towards what the user is looking at. */
  near?: { lat: number; lng: number } | null;
  placeholder?: string;
  className?: string;
}

/**
 * Search places, addresses and landmarks, and drop the marker on the result.
 *
 * Sits above the map rather than floating over it: an overlay would cover the
 * tiles exactly where the results list needs to be read, and on a phone it
 * would collide with the zoom controls.
 */
export function MapSearchBox({
  onSelect,
  near = null,
  placeholder = "Search a place, or paste coordinates…",
  className,
}: MapSearchBoxProps) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // A pasted coordinate pair needs no geocoding, so the request is skipped
  // entirely rather than sent and discarded.
  const coordinates = parseCoordinates(query);

  const { results, isSearching, isEmpty, failed } = useGeocodeSearch(query, {
    near,
    enabled: open && !coordinates,
  });

  // Best-effort "what is actually here", so the user can tell a mistyped digit
  // from the point they meant. Never blocks: the coordinate option is offered
  // immediately and this only fills in the second line if and when it arrives.
  const { data: coordinateLabel } = useQuery({
    queryKey: ["reverse-geocode", coordinates?.lat, coordinates?.lng],
    queryFn: () => reverseGeocodeLandmark(coordinates!.lat, coordinates!.lng),
    enabled: !!coordinates && open,
    staleTime: Infinity,
    retry: false,
  });

  const options: PlaceResult[] = coordinates
    ? [
        {
          id: `coordinates:${coordinates.lat},${coordinates.lng}`,
          name: formatCoordinates(coordinates),
          address: coordinateLabel ?? "Go to these exact coordinates",
          kind: "coordinates",
          lat: coordinates.lat,
          lng: coordinates.lng,
        },
      ]
    : results;

  // Clamped rather than reset from an effect: a stale index left over from a
  // previous, longer result set must not highlight (or Enter-select) the wrong
  // row, and resetting it in an effect would cost a cascading render.
  const highlighted = activeIndex < options.length ? activeIndex : -1;

  // Clicking the map (or anything else) should dismiss the list.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function choose(place: PlaceResult) {
    onSelect(place);
    setQuery(place.name);
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!options.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(() => (highlighted + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(() => (highlighted <= 0 ? options.length - 1 : highlighted - 1));
    } else if (event.key === "Enter") {
      // Only swallow Enter when a result is highlighted — otherwise this box
      // would eat the submit of the form it is embedded in.
      if (highlighted >= 0) {
        event.preventDefault();
        choose(options[highlighted]);
      }
    }
  }

  const showList = open && (!!coordinates || query.trim().length >= 3);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <Search
          className="text-ink-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <input
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(
            "h-11 w-full rounded-md border bg-surface pr-9 pl-9 text-sm transition-colors",
            "border-line text-ink focus-visible:border-brand focus-visible:outline-none",
          )}
        />
        {isSearching ? (
          <Loader2
            className="text-ink-faint absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin"
            aria-hidden="true"
          />
        ) : (
          query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setOpen(false);
              }}
              aria-label="Clear search"
              className="text-ink-faint hover:text-ink absolute top-1/2 right-2 -translate-y-1/2 rounded p-1"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )
        )}
      </div>

      {showList && (
        <div className="absolute inset-x-0 top-full z-[1100] mt-1 overflow-hidden rounded-md border border-line bg-surface shadow-md">
          <ul id={listId} role="listbox" className="max-h-64 overflow-auto py-1">
            {options.map((place, index) => (
              <li key={place.id} role="option" aria-selected={index === highlighted}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(place)}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2 text-left text-sm",
                    index === highlighted ? "bg-surface-hover" : "hover:bg-surface-hover",
                  )}
                >
                  {place.kind === "coordinates" ? (
                    <Crosshair
                      className="text-ink-faint mt-0.5 size-4 shrink-0"
                      aria-hidden="true"
                    />
                  ) : (
                    <MapPin
                      className="text-ink-faint mt-0.5 size-4 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="text-ink block truncate font-medium">
                      {place.name}
                      {place.kind && (
                        <span className="text-ink-faint ml-2 text-xs font-normal">
                          {place.kind}
                        </span>
                      )}
                    </span>
                    <span className="text-ink-muted block truncate text-xs">
                      {place.address}
                    </span>
                  </span>
                </button>
              </li>
            ))}

            {!options.length && (
              <li className="text-ink-muted px-3 py-3 text-sm">
                {isSearching
                  ? "Searching…"
                  : failed
                    ? "Place search is unavailable right now — you can still tap the map."
                    : isEmpty
                      ? "No places found. Try a landmark or a nearby road."
                      : null}
              </li>
            )}
          </ul>
          {/* Nominatim's usage policy requires attribution wherever results appear. */}
          <p className="text-ink-faint border-t border-line px-3 py-1.5 text-[11px]">
            Search by OpenStreetMap / Nominatim
          </p>
        </div>
      )}
    </div>
  );
}
