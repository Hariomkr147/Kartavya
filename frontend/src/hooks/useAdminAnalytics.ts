import { useQuery } from "@tanstack/react-query";
import { getSystemAnalytics } from "@/services/admin";

/** The endpoint is documented as "always reflects current database state", so
 * the dashboard polls it rather than only refreshing on mount/navigation. */
export function useAdminAnalytics() {
  return useQuery({
    queryKey: ["admin", "analytics"],
    queryFn: getSystemAnalytics,
    refetchInterval: 45_000,
  });
}
