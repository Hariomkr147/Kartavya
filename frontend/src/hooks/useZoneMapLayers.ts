import { useCallback, useEffect, useMemo, useState } from "react";
import { csvCodec, useSearchParamState } from "@/hooks/useSearchParamState";
import {
  DEFAULT_LAYERS,
  LAYER_KEYS,
  layerStateFrom,
  type ZoneMapLayerKey,
  type ZoneMapLayerState,
} from "@/lib/zoneMapLayers";

const STORAGE_KEY = "kartavya-zoneMap-layers";

/**
 * The layer set last seen on either map, read once at mount.
 *
 * Anything not still a known `ZoneMapLayerKey` is dropped rather than kept
 * or rejected outright — the same tolerance `layerStateFrom` gives a shared
 * `?layers=` link, for the same reason: a layer renamed or removed since this
 * was saved shouldn't resurrect as a crash or a phantom toggle next time the
 * map opens.
 */
function readRememberedLayers(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (k): k is ZoneMapLayerKey =>
        typeof k === "string" && LAYER_KEYS.includes(k as ZoneMapLayerKey),
    );
  } catch {
    return null;
  }
}

function rememberLayers(active: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
  } catch {
    // Storage full/unavailable — this is a convenience, never required.
  }
}

/**
 * Which map layers are switched on, held in the URL (`?layers=…`) the way the
 * complaint filters are — so "the map with just clusters and zone regions"
 * can be sent to someone as a link, and survives a reload.
 *
 * The URL only ever holds a layer set once something has changed it — a
 * fresh session opening `/admin/map` with no `?layers=` at all falls back to
 * whatever was last seen on either map, in `localStorage`, rather than always
 * snapping back to `DEFAULT_LAYERS`. `DEFAULT_LAYERS` is still what a citizen
 * who has genuinely never opened the map gets, and still what "reset" would
 * mean if this page grows one. The URL stays the moment-to-moment source of
 * truth: a shared link's `?layers=` always wins over the local memory, and
 * every resulting change — from a toggle or from opening someone else's link
 * — is what gets remembered for the next visit with no link at all.
 */
export function useZoneMapLayers(): {
  layers: ZoneMapLayerState;
  toggle: (key: ZoneMapLayerKey) => void;
} {
  const [rememberedDefault] = useState(() => readRememberedLayers() ?? DEFAULT_LAYERS);

  const [active, setActive] = useSearchParamState<string[]>(
    "layers",
    rememberedDefault,
    csvCodec,
  );

  useEffect(() => {
    rememberLayers(active);
  }, [active]);

  const layers = useMemo(() => layerStateFrom(active), [active]);

  const toggle = useCallback(
    (key: ZoneMapLayerKey) =>
      setActive((prev) =>
        prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
      ),
    [setActive],
  );

  return { layers, toggle };
}
