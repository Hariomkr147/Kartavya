import { useCallback, useMemo } from "react";
import { csvCodec, useSearchParamState } from "@/hooks/useSearchParamState";
import {
  DEFAULT_LAYERS,
  layerStateFrom,
  type ZoneMapLayerKey,
  type ZoneMapLayerState,
} from "@/lib/zoneMapLayers";

/**
 * Which map layers are switched on, held in the URL (`?layers=…`) the way the
 * complaint filters are — so "the map with just clusters and zone regions"
 * can be sent to someone as a link, and survives a reload.
 */
export function useZoneMapLayers(): {
  layers: ZoneMapLayerState;
  toggle: (key: ZoneMapLayerKey) => void;
} {
  const [active, setActive] = useSearchParamState<string[]>(
    "layers",
    DEFAULT_LAYERS,
    csvCodec,
  );

  const layers = useMemo(() => layerStateFrom(active), [active]);

  const toggle = useCallback(
    (key: ZoneMapLayerKey) =>
      setActive(
        active.includes(key) ? active.filter((k) => k !== key) : [...active, key],
      ),
    [active, setActive],
  );

  return { layers, toggle };
}
