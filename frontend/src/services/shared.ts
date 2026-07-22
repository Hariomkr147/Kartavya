import { apiFetch, type QueryParams } from "./http";
import type { ClusterDetail, ClusterListResponse, ZoneSummary } from "@/types/api";

export interface GetClustersParams extends QueryParams {
  /** Admin only — officers are always scoped server-side to their own zone. */
  zoneId?: string;
  page?: number;
  pageSize?: number;
}

export function getClusters(params: GetClustersParams = {}): Promise<ClusterListResponse> {
  return apiFetch<ClusterListResponse>("/clusters", { query: params });
}

export function getClusterById(clusterId: string): Promise<ClusterDetail> {
  return apiFetch<ClusterDetail>(`/clusters/${clusterId}`);
}

export function getZoneSummary(zoneId: string): Promise<ZoneSummary> {
  return apiFetch<ZoneSummary>(`/zones/${zoneId}/summary`);
}
