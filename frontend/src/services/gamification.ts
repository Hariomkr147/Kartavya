import { apiFetch } from "./http";
import type { Badge, LeaderboardResponse, PointsSummary } from "@/types/api";

export function getMyPoints(
  params: { page?: number; pageSize?: number } = {},
): Promise<PointsSummary> {
  return apiFetch<PointsSummary>("/gamification/points", { query: params });
}

export function getMyBadges(): Promise<Badge[]> {
  return apiFetch<Badge[]>("/gamification/badges");
}

export function getLeaderboard(params: {
  scope: "zone" | "city";
  period?: "monthly" | "all_time";
  page?: number;
  pageSize?: number;
}): Promise<LeaderboardResponse> {
  return apiFetch<LeaderboardResponse>("/leaderboard", { query: params });
}
