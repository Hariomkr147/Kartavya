import { useQuery } from "@tanstack/react-query";
import { getOfficerAnalytics, type GetOfficerAnalyticsParams } from "@/services/officer";

/** The officer dashboard bills itself as live zone status, so it polls rather
 * than only refreshing on mount/navigation — same cadence as the admin one. */
export function useOfficerAnalytics(params: GetOfficerAnalyticsParams = {}) {
  return useQuery({
    queryKey: ["officer", "analytics", params],
    queryFn: () => getOfficerAnalytics(params),
    refetchInterval: 45_000,
  });
}
