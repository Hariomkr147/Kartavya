import { useQuery } from "@tanstack/react-query";
import { LIVE_REFRESH_MS } from "@/lib/queryClient";
import { getOfficerAnalytics, type GetOfficerAnalyticsParams } from "@/services/officer";

/** The officer dashboard bills itself as live zone status, so it polls rather
 * than only refreshing on mount/navigation. Cadence is shared — see
 * `LIVE_REFRESH_MS`. */
export function useOfficerAnalytics(params: GetOfficerAnalyticsParams = {}) {
  return useQuery({
    queryKey: ["officer", "analytics", params],
    queryFn: () => getOfficerAnalytics(params),
    refetchInterval: LIVE_REFRESH_MS,
  });
}
