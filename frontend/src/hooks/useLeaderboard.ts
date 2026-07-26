import { useQuery } from "@tanstack/react-query";
import { getLeaderboard } from "@/services/gamification";

export function useLeaderboard(params: {
  scope: "zone" | "city";
  period?: "monthly" | "all_time";
  page?: number;
  pageSize?: number;
}) {
  return useQuery({
    queryKey: ["leaderboard", params],
    queryFn: () => getLeaderboard(params),
  });
}
