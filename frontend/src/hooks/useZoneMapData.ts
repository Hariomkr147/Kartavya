import { useQueries, useQuery } from "@tanstack/react-query";
import { getClusters } from "@/services/shared";
import { getAllComplaints } from "@/services/admin";
import { getClusterById } from "@/services/shared";
import { OPEN_STATUSES } from "@/lib/lifecycle";
import type { Cluster, ClusterDetail, Complaint } from "@/types/api";

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
 */
export function useMapComplaints() {
  return useQuery({
    queryKey: ["admin", "map", "complaints", "open"],
    queryFn: () =>
      fetchUpTo<Complaint>(MAP_COMPLAINT_LIMIT, (page, pageSize) =>
        getAllComplaints({ page, pageSize, status: OPEN_STATUSES }),
      ),
  });
}

export function useMapClusters() {
  return useQuery({
    queryKey: ["admin", "map", "clusters"],
    queryFn: () =>
      fetchUpTo<Cluster>(MAP_CLUSTER_LIMIT, (page, pageSize) =>
        getClusters({ page, pageSize }),
      ),
  });
}

/**
 * Member complaints for each cluster, so their individual pins can be drawn.
 *
 * `GET /clusters` returns centroids only — a cluster's members, with their own
 * coordinates and photos, live on `GET /clusters/{id}`. That is one request per
 * cluster, so this only runs when the members layer is switched on, and only
 * for the first `MAP_MEMBER_CLUSTER_LIMIT` clusters. React Query dedupes and
 * caches each one, so toggling the layer back on is free.
 */
export function useClusterMembers(clusterIds: string[], enabled: boolean) {
  const ids = clusterIds.slice(0, MAP_MEMBER_CLUSTER_LIMIT);
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["cluster", id],
      queryFn: () => getClusterById(id),
      enabled,
    })),
  });

  const loaded = results
    .map((r) => r.data)
    .filter((d): d is ClusterDetail => d !== undefined);

  return {
    clusters: loaded,
    isLoading: enabled && results.some((r) => r.isLoading),
    /** Clusters beyond the ceiling, whose members are deliberately not drawn. */
    omittedCount: Math.max(0, clusterIds.length - ids.length),
  };
}
