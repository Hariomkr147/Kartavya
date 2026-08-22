import type { TranslationKey } from "@/i18n";

/**
 * Which layers of the zone map are drawn.
 *
 * Lives in `lib/` rather than beside the map component because three things
 * need to agree on it: the map that draws the layers, the toggle panel that
 * names them, and the URL state that persists them. Two audiences now share
 * all three (`/admin/map` and `/officer/map`), so a layer added here appears
 * on both maps or on neither — there is no second list to forget.
 */
export interface ZoneMapLayerState {
  zoneRegions: boolean;
  zoneLabels: boolean;
  clusters: boolean;
  clusterMembers: boolean;
  standalone: boolean;
  tethers: boolean;
}

export type ZoneMapLayerKey = keyof ZoneMapLayerState;

/** Every layer key, and the i18n key naming it in the toggle panel. */
export const LAYER_LABELS: Record<ZoneMapLayerKey, TranslationKey> = {
  zoneRegions: "zoneMap.zoneRegions",
  zoneLabels: "zoneMap.zoneLabels",
  clusters: "nav.clusters",
  clusterMembers: "zoneMap.clusterMembers",
  tethers: "zoneMap.tethers",
  standalone: "zoneMap.standalone",
};

export const LAYER_KEYS = Object.keys(LAYER_LABELS) as ZoneMapLayerKey[];

/** Cluster members are off by default — they cost one request per cluster. */
export const DEFAULT_LAYERS: ZoneMapLayerKey[] = [
  "zoneRegions",
  "zoneLabels",
  "clusters",
  "standalone",
  // On by default, but only ever drawn alongside the members layer, which is
  // off — so this costs nothing until the layer is switched on.
  "tethers",
];

/**
 * The URL's list of active layer names, as the flag object the map takes.
 *
 * Unknown names in the list are ignored rather than rejected: `?layers=` is a
 * shareable link, and a stale one naming a layer that has since been renamed
 * should still draw the layers it does name.
 */
export function layerStateFrom(active: string[]): ZoneMapLayerState {
  return LAYER_KEYS.reduce(
    (state, key) => ({ ...state, [key]: active.includes(key) }),
    {} as ZoneMapLayerState,
  );
}
