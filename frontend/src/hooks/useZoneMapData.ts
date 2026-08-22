import { useQueries, useQuery } from "@tanstack/react-query";
import { LIVE_REFRESH_MS } from "@/lib/queryClient";
import { getClusters } from "@/services/shared";
import { getAllComplaints } from "@/services/admin";
import { getOfficerQueue } from "@/services/officer";
import { getClusterById } from "@/services/shared";
import { OPEN_STATUSES } from "@/lib/lifecycle";
import type { Cluster, ClusterDetail, Complaint } from "@/types/api";

/**
 * The data behind the zone map, for both audiences.
 *
 * Every query in this file polls on `LIVE_REFRESH_MS` — the same clock the
 * officer and admin analytics run on, which is what the stat tiles sitting
 * directly above the link into this map use. Without it a map left open
 * showed whatever was true when it was opened, for as long as it stayed
 * open: nothing in this app pushes, and `refetchOnWindowFocus` is off
 * globally, so a complaint filed while an officer watched the map would never
 * have appeared.
 */

/**
 * Whose map this is.
 *
 * It decides which endpoint the complaints come from, and nothing else. That
 * is the whole of the difference: `/officer/complaints` is scoped to the
 * officer's own zone by `visible_complaints`, and `/clusters` by
 * `visible_clusters`, so an officer's map is confined to their zone by the
 * server rather than by a filter the client could get wrong. The pages filter
 * on `zoneId` as well, but as a second lock, not the first one.
 */
export type MapAudience = "admin" | "officer";

/**
 * The map is not paginated, but the API is: `pageSize` is capped at 100
 * (openapi.yaml `PageSize`). Rather than pretend otherwise, each list is
 * fetched a page at a time up to a stated ceiling, and the page reports what
 * it actually plotted. A map that silently shows the first hundred of nine
 * hundred complaints is worse than one that says so.
 */
const PAGE_SIZE = 100;
export const MAP_COMPLAINT_LIMIT = 600;
export const MAP_CLUSTER_LIMIT = 300;
/** Cluster members are one request per cluster, so this ceiling is much lower. */
export const MAP_MEMBER_CLUSTER_LIMIT = 40;

interface Paged<T> {
  data: T[];
  pagination: { totalItems: number; totalPages: number };
}

async function fetchUpTo<T>(
  limit: number,
  fetchPage: (page: number, pageSize: number) => Promise<Paged<T>>,
): Promise<{ items: T[]; totalItems: number }> {
  const items: T[] = [];
  let page = 1;
  let totalItems = 0;
  let totalPages = 1;

  while (items.length < limit && page <= totalPages) {
    const result = await fetchPage(page, PAGE_SIZE);
    totalItems = result.pagination.totalItems;
    totalPages = result.pagination.totalPages;
    items.push(...result.data);
    page += 1;
  }

  return { items: items.slice(0, limit), totalItems };
}

/**
 * Open complaints only — the map means "work that can still move".
 *
 * The cluster layer is already live-only: `visible_clusters` hides a cluster
 * once every member has reached CLOSED, REJECTED or UNRESOLVABLE. Fetching
 * complaints unfiltered made the two layers disagree, and worse, a complaint
 * that goes terminal *leaves its cluster* — `exit_cluster()` nulls its
 * `clusterId` — so a closed ex-member came back onto the map as an
 * independent pin. It is neither independent nor live. Filtering at the fetch
 * settles both: `clusterId == null` can be read as "standalone" again,
 * because the terminal complaints that would have lied about it are gone.
 *
 * The filter is on the request, not on the rows, so the ceiling below is
 * spent on complaints worth drawing and the reported total counts the same
 * set the map shows.
 *
 * The key nests under the audience's own list key (`["admin", "complaints",
 * …]` / `["officer", "queue", …]`) rather than beside it, so the existing
 * `invalidateQueries` calls in the lifecycle mutations reach the map by
 * prefix. An officer who claims a complaint in another tab and comes back to
 * the map should not be looking at the queue as it was before the claim.
 */
export function useMapComplaints(audience: MapAudience) {
  return useQuery({
    queryKey:
      audience === "admin"
        ? ["admin", "complaints", "map", "open"]
        : ["officer", "queue", "map", "open"],
    queryFn: () =>
      fetchUpTo<Complaint>(MAP_COMPLAINT_LIMIT, (page, pageSize) =>
        audience === "admin"
          ? getAllComplaints({ page, pageSize, status: OPEN_STATUSES })
          : getOfficerQueue({ page, pageSize, status: OPEN_STATUSES }),
      ),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

/**
 * `GET /clusters` is one endpoint for both audiences — `visible_clusters`
 * narrows it to the officer's zone server-side — so there is one query key.
 * It sits under `["clusters", …]` for the same invalidation reason as above.
 */
export function useMapClusters() {
  return useQuery({
    queryKey: ["clusters", "map"],
    queryFn: () =>
      fetchUpTo<Cluster>(MAP_CLUSTER_LIMIT, (page, pageSize) =>
        getClusters({ page, pageSize }),
      ),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

/**
 * Member complaints for each cluster, so their individual pins can be drawn.
 *
 * `GET /clusters` returns centroids only — a cluster's members, with their own
 * coordinates and photos, live on `GET /clusters/{id}`. That is one request per
 * cluster, so this only runs when the members layer is switched on, and only
 * for the first `MAP_MEMBER_CLUSTER_LIMIT` clusters.
 *
 * The key is `useCluster`'s own (`["clusters", id]`), so opening a cluster
 * page after switching the layer on is served from cache — and, more to the
 * point, so a cluster the officer has just acted on is invalidated here too.
 *
 * These refresh on the same clock as the two lists above, which is the
 * expensive half of the interval: this is one request per cluster, so a map
 * with the layer on and the ceiling reached costs 40 requests a tick against
 * the lists' 9. It is still the right trade. Polling the discs but not their
 * members would leave a member pin drawn for a complaint that has since gone
 * terminal and left the cluster, next to a disc whose count has already
 * dropped — a map that contradicts itself is worse than one that costs more.
 * The layer is off by default, so nobody pays this without asking for it.
 */
export function useClusterMembers(clusterIds: string[], enabled: boolean) {
  const ids = clusterIds.slice(0, MAP_MEMBER_CLUSTER_LIMIT);
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["clusters", id],
      queryFn: () => getClusterById(id),
      enabled,
      refetchInterval: LIVE_REFRESH_MS,
    })),
  });

  const loaded = results
    .map((r) => r.data)
    .filter((d): d is ClusterDetail => d !== undefined);

  return {
    clusters: loaded,
    isLoading: enabled && results.some((r) => r.isLoading),
    isFetching: enabled && results.some((r) => r.isFetching),
    /** So the page's manual refresh reaches the member pins too, not just the discs. */
    refetch: () => Promise.all(results.map((r) => r.refetch())),
    /** Clusters beyond the ceiling, whose members are deliberately not drawn. */
    omittedCount: Math.max(0, clusterIds.length - ids.length),
  };
}
