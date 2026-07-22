import { useQuery } from "@tanstack/react-query";
import { getPublicOfficerStats } from "@/services/officers";

export function useOfficerStats(officerId: string | null | undefined) {
  return useQuery({
    queryKey: ["officers", officerId, "stats"],
    queryFn: () => getPublicOfficerStats(officerId!),
    enabled: !!officerId,
  });
}
