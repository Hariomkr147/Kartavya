import { apiFetch, type QueryParams } from "./http";
import type { FeedListResponse } from "@/types/api";

export interface GetFeedParams extends QueryParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  includeResolved?: boolean;
  categoryId?: string;
}

export function getFeed(params: GetFeedParams = {}): Promise<FeedListResponse> {
  return apiFetch<FeedListResponse>("/feed", { query: params });
}
