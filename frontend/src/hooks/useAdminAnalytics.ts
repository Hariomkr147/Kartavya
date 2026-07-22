import { useQuery } from "@tanstack/react-query";
import { getSystemAnalytics } from "@/services/admin";

export function useAdminAnalytics() {
  return useQuery({
    queryKey: ["admin", "analytics"],
    queryFn: getSystemAnalytics,
  });
}
