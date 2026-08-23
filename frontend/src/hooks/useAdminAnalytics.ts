import { useQuery } from "@tanstack/react-query";
import { LIVE_REFRESH_MS } from "@/lib/queryClient";
import { getSystemAnalytics } from "@/services/admin";

/** The endpoint is documented as "always reflects current database state", so
 * the dashboard polls it rather than only refreshing on mount/navigation. */
export function useAdminAnalytics() {
  return useQuery({
    queryKey: ["admin", "analytics"],
    queryFn: getSystemAnalytics,
    refetchInterval: LIVE_REFRESH_MS,
  });
}
