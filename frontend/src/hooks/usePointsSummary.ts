import { useQuery } from "@tanstack/react-query";
import { getMyPoints } from "@/services/gamification";

export function usePointsSummary(params: { page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: ["gamification", "points", params],
    queryFn: () => getMyPoints(params),
  });
}
