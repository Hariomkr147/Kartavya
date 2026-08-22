import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { ZoneMapLayers } from "@/components/map/ZoneMapLayers";
import { ZoneMapLayerToggles } from "@/components/map/ZoneMapLayerToggles";
import { useAuth } from "@/contexts/AuthContext";
import { useZones } from "@/hooks/useZones";
import { useZoneMapLayers } from "@/hooks/useZoneMapLayers";
import {
  useClusterMembers,
  useMapClusters,
  useMapComplaints,
} from "@/hooks/useZoneMapData";

/**
 * An officer's complaint lives under the queue, not `/officer/complaints` —
 * the route is `queue/:complaintId` (see `routes/router.tsx`).
 */
const LINKS = {
  complaint: (id: string) => `/officer/queue/${id}`,
  cluster: (id: string) => `/officer/clusters/${id}`,
};

/**
 * The officer's zone, drawn.
 *
 * The same map as `/admin/map`, minus the zone filter — an officer works
 * exactly one zone, so there is nothing to filter to. What replaces the
 * filter is emphasis: their cell is drawn as the figure and the neighbouring
 * cells as ground, which is the only honest way to show a Voronoi region
 * (a cell's boundary is the perpendicular bisector to its neighbours' centres,
 * so the neighbours cannot be left out and still leave a shape).
 */
export function OfficerZoneMapPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const zoneId = user?.zoneId ?? null;
  const { layers, toggle } = useZoneMapLayers();

  const { data: zones, isLoading: zonesLoading } = useZones();
  const {
    data: complaints,
    isLoading: complaintsLoading,
    isFetching: complaintsFetching,
    refetch: refetchComplaints,
  } = useMapComplaints("officer");
  const {
    data: clusters,
    isLoading: clustersLoading,
    isFetching: clustersFetching,
    refetch: refetchClusters,
  } = useMapClusters();

  // Both lists arrive already narrowed to this officer's zone —
  // `visible_complaints` and `visible_clusters` do it in the query, not after
  // the fetch. Filtering again here is a second lock on the same door: if a
  // scoping regression ever let another zone's row through, it still does not
  // get drawn on an officer's map.
  const visibleClusters = useMemo(
    () => (clusters?.items ?? []).filter((c) => c.zoneId === zoneId),
    [clusters, zoneId],
  );

  // "Standalone" is the complement of cluster membership: a complaint that is
  // nobody's duplicate. `clusterId` is on the compact shape precisely so a
  // list can tell the two apart without a second request.
  const standalone = useMemo(
    () =>
      (complaints?.items ?? []).filter(
        (c) =>
          c.zoneId === zoneId &&
          c.clusterId == null &&
          c.latitude != null &&
          c.longitude != null,
      ),
    [complaints, zoneId],
  );

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
  const homeZone = (zones ?? []).find((z) => z.id === zoneId);

  // An officer with no zone has no map, and the backend agrees — every scoped
  // read answers 403 for them. Say why rather than drawing an empty city.
  if (!loading && !homeZone) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <h1 className="font-display text-xl font-semibold text-ink">
          {t("zoneMap.title")}
        </h1>
        <EmptyState
          icon={MapIcon}
          title={t("zoneMap.noZones")}
          description={t("account.assignedZoneHint")}
          className="rounded-lg border border-line bg-surface py-24"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h1 className="font-display text-xl font-semibold text-ink">
            {t("zoneMap.title")}
          </h1>
          {homeZone && (
            <span className="text-ink-muted text-sm">
              {t("fields.yourZone")} · {homeZone.name}
            </span>
          )}
        </div>
        {/* The map polls, but every other list in the app also offers "fetch
            this again now" — an officer who has just claimed something should
            not have to wait out the interval to see it move. */}
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
        <ZoneMapLayerToggles layers={layers} onToggle={toggle} />
      </div>

      {loading ? (
        <Skeleton className="h-[620px] w-full" />
      ) : (
        <>
          <ZoneMapLayers
            zones={zones ?? []}
            clusters={visibleClusters}
            standalone={standalone}
            clusterDetails={clusterDetails}
            layers={layers}
            links={LINKS}
            focusZoneId={zoneId ?? undefined}
            focusLabel={t("fields.yourZone")}
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
