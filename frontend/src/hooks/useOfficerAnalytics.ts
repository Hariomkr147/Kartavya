import { useQuery } from "@tanstack/react-query";
import { getOfficerAnalytics } from "@/services/officer";

export function useOfficerAnalytics() {
  return useQuery({
    queryKey: ["officer", "analytics"],
    queryFn: getOfficerAnalytics,
  });
}
