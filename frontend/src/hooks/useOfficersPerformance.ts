import { useQuery } from "@tanstack/react-query";
import { getOfficerPerformance, type GetOfficerPerformanceParams } from "@/services/admin";
import type { OfficerPerformance } from "@/types/api";

/**
 * Fans `GET /admin/officers/{id}/performance` out across a whole officer
 * roster (one request per officer, run in parallel) so the roster table can
 * sort/compare officers on metrics the contract only exposes one-at-a-time.
 */
export function useOfficersPerformance(
  officerIds: string[],
  params: GetOfficerPerformanceParams = {},
) {
  return useQuery({
    queryKey: ["admin", "officers", "performance", officerIds, params],
    queryFn: async () => {
      const results = await Promise.all(
        officerIds.map((id) => getOfficerPerformance(id, params)),
      );
      const byOfficerId = new Map<string, OfficerPerformance>();
      for (const result of results) byOfficerId.set(result.officerId, result);
      return byOfficerId;
    },
    enabled: officerIds.length > 0,
  });
}
