import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { Combobox } from "@/components/ui/Combobox";
import { Label } from "@/components/ui/Label";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { ZoneMapLayers } from "@/components/map/ZoneMapLayers";
import { ZoneMapLayerToggles } from "@/components/map/ZoneMapLayerToggles";
import { useZones } from "@/hooks/useZones";
import { useZoneMapLayers } from "@/hooks/useZoneMapLayers";
import { useSearchParamState } from "@/hooks/useSearchParamState";
import {
  useClusterMembers,
  useMapClusters,
  useMapComplaints,
} from "@/hooks/useZoneMapData";

/** An admin's complaint lives under `/admin/complaints`, not the officer queue. */
const LINKS = {
  complaint: (id: string) => `/admin/complaints/${id}`,
  cluster: (id: string) => `/admin/clusters/${id}`,
};

export function AdminZoneMapPage() {
  const { t } = useTranslation();
  const [zoneId, setZoneId] = useSearchParamState("zone", "");
  const { layers, toggle } = useZoneMapLayers();

  const { data: zones, isLoading: zonesLoading } = useZones();
  const {
    data: complaints,
    isLoading: complaintsLoading,
    isFetching: complaintsFetching,
    refetch: refetchComplaints,
  } = useMapComplaints("admin");
  const {
    data: clusters,
    isLoading: clustersLoading,
    isFetching: clustersFetching,
    refetch: refetchClusters,
  } = useMapClusters();

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
    isFetching: membersFetching,
    refetch: refetchMembers,
    omittedCount,
  } = useClusterMembers(
    visibleClusters.map((c) => c.id),
    layers.clusterMembers,
  );

  const loading = zonesLoading || complaintsLoading || clustersLoading;
  const mappableZones = (zones ?? []).filter((z) => !z.isCatchAll && z.isActive);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-xl font-semibold text-ink">
          {t("zoneMap.title")}
        </h1>
        {/* The map polls, but every other list in the app also offers "fetch
            this again now" — an admin who has just changed something in
            another tab should not have to wait out the interval. */}
        <RefreshButton
          onRefresh={() => {
            void refetchComplaints();
            void refetchClusters();
            void refetchMembers();
          }}
          refreshing={complaintsFetching || clustersFetching || membersFetching}
          what="this map"
        />
      </div>

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
        <ZoneMapLayerToggles layers={layers} onToggle={toggle} />
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
            links={LINKS}
            // Filtering to a zone makes that zone what the map is about, so
            // its cell becomes the figure and the map opens on its centre.
            // The legend is left unlabelled: the zone's name is already in
            // the filter directly above and written across its own cell.
            focusZoneId={zoneId || undefined}
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
