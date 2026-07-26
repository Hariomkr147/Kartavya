import { useQuery } from "@tanstack/react-query";
import { getZoneSummary } from "@/services/shared";

export function useZoneSummary(zoneId: string | null | undefined) {
  return useQuery({
    queryKey: ["zones", zoneId, "summary"],
    queryFn: () => getZoneSummary(zoneId!),
    enabled: !!zoneId,
  });
}
