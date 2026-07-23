import { useQuery } from "@tanstack/react-query";
import { getOfficerPerformance, type GetOfficerPerformanceParams } from "@/services/admin";

export function useOfficerPerformance(
  officerId: string | null | undefined,
  params: GetOfficerPerformanceParams = {},
) {
  return useQuery({
    queryKey: ["admin", "officers", officerId, "performance", params],
    queryFn: () => getOfficerPerformance(officerId!, params),
    enabled: !!officerId,
  });
}
