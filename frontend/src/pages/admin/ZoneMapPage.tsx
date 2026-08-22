import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/Checkbox";
import { Combobox } from "@/components/ui/Combobox";
import { Label } from "@/components/ui/Label";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ZoneMapLayers, type ZoneMapLayerState } from "@/components/admin/ZoneMapLayers";
import { useZones } from "@/hooks/useZones";
import { useSearchParamState, csvCodec } from "@/hooks/useSearchParamState";
import {
  useClusterMembers,
  useMapClusters,
  useMapComplaints,
} from "@/hooks/useZoneMapData";
import type { TranslationKey } from "@/i18n";

/**
 * Every layer key, and the i18n key naming it in the toggle panel. Layers live
 * in the URL (`?layers=…`) like the complaint filters do, so an admin can send
 * someone "the map with just clusters and zone regions" as a link.
 */
const LAYER_LABELS: Record<keyof ZoneMapLayerState, TranslationKey> = {
  zoneRegions: "zoneMap.zoneRegions",
  zoneLabels: "zoneMap.zoneLabels",
  clusters: "nav.clusters",
  clusterMembers: "zoneMap.clusterMembers",
  tethers: "zoneMap.tethers",
  standalone: "zoneMap.standalone",
};

const LAYER_KEYS = Object.keys(LAYER_LABELS) as (keyof ZoneMapLayerState)[];

/** Cluster members are off by default — they cost one request per cluster. */
const DEFAULT_LAYERS: (keyof ZoneMapLayerState)[] = [
  "zoneRegions",
  "zoneLabels",
  "clusters",
  "standalone",
  // On by default, but only ever drawn alongside the members layer, which is
  // off — so this costs nothing until an admin asks to see members.
  "tethers",
];

export function AdminZoneMapPage() {
  const { t } = useTranslation();
  const [zoneId, setZoneId] = useSearchParamState("zone", "");
  const [active, setActive] = useSearchParamState<string[]>(
    "layers",
    DEFAULT_LAYERS,
    csvCodec,
  );

  const { data: zones, isLoading: zonesLoading } = useZones();
  const { data: complaints, isLoading: complaintsLoading } = useMapComplaints();
  const { data: clusters, isLoading: clustersLoading } = useMapClusters();

  const layers = useMemo(
    () =>
      LAYER_KEYS.reduce(
        (state, key) => ({ ...state, [key]: active.includes(key) }),
        {} as ZoneMapLayerState,
      ),
    [active],
  );

  const visibleClusters = useMemo(() => {
    const all = clusters?.items ?? [];
    return zoneId ? all.filter((c) => c.zoneId === zoneId) : all;
  }, [clusters, zoneId]);

  // "Standalone" is the complement of cluster membership: a complaint that is
  // nobody's duplicate. `clusterId` is on the compact shape precisely so a
  // list can tell the two apart without a second request. A complaint that has
  // since left its cluster (terminal states do that) is standalone again, and
  // correctly draws as its own pin.
  const standalone = useMemo(() => {
    const all = (complaints?.items ?? []).filter(
      (c) => c.clusterId == null && c.latitude != null && c.longitude != null,
    );
    return zoneId ? all.filter((c) => c.zoneId === zoneId) : all;
  }, [complaints, zoneId]);

  const {
    clusters: clusterDetails,
    isLoading: membersLoading,
    omittedCount,
  } = useClusterMembers(
    visibleClusters.map((c) => c.id),
    layers.clusterMembers,
  );

  function toggleLayer(key: keyof ZoneMapLayerState) {
    setActive(active.includes(key) ? active.filter((k) => k !== key) : [...active, key]);
  }

  const loading = zonesLoading || complaintsLoading || clustersLoading;
  const mappableZones = (zones ?? []).filter((z) => !z.isCatchAll && z.isActive);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <h1 className="font-display text-xl font-semibold text-ink">
        {t("zoneMap.title")}
      </h1>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-line bg-surface p-4">
        <div className="min-w-[14rem]">
          <Label htmlFor="map-zone">{t("filters.zone")}</Label>
          <Combobox
            id="map-zone"
            value={zoneId}
            onChange={setZoneId}
            options={[
              { value: "", label: t("filters.allZones") },
              ...(zones ?? []).map((z) => ({ value: z.id, label: z.name })),
            ]}
          />
        </div>
        <div className="flex-1">
          <Label id="map-layers-label">{t("zoneMap.layers")}</Label>
          <div
            role="group"
            aria-labelledby="map-layers-label"
            className="flex flex-wrap gap-x-5 gap-y-2"
          >
            {LAYER_KEYS.map((key) => (
              <Checkbox
                key={key}
                checked={layers[key]}
                onChange={() => toggleLayer(key)}
                label={t(LAYER_LABELS[key])}
              />
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-[620px] w-full" />
      ) : mappableZones.length === 0 ? (
        <EmptyState
          icon={MapIcon}
          title={t("zoneMap.noZones")}
          description={t("adminZones.createBody")}
          className="rounded-lg border border-line bg-surface py-24"
        />
      ) : (
        <>
          <ZoneMapLayers
            zones={zones ?? []}
            clusters={visibleClusters}
            standalone={standalone}
            clusterDetails={clusterDetails}
            layers={layers}
          />
          <p className="text-ink-muted text-xs">
            {t("feed.mapNote", {
              pins: standalone.length + visibleClusters.length,
              total: (complaints?.totalItems ?? 0) + (clusters?.totalItems ?? 0),
            })}
            {layers.clusterMembers && omittedCount > 0 && (
              <> {t("zoneMap.memberLimitNote", { count: omittedCount })}</>
            )}
            {membersLoading && <> {t("common.loading")}</>}
          </p>
        </>
      )}
    </div>
  );
}
