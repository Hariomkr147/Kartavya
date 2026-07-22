import { useQuery } from "@tanstack/react-query";
import { getAiZoneReport } from "@/services/admin";

/** Polls every 1.5s while a report is still PENDING, so the generate-report UI updates itself once the async mock job finishes. */
export function useAiZoneReport(zoneId: string | null | undefined) {
  return useQuery({
    queryKey: ["admin", "zones", zoneId, "ai-report"],
    queryFn: () => getAiZoneReport(zoneId!),
    enabled: !!zoneId,
    retry: false,
    refetchInterval: (query) => (query.state.data?.status === "PENDING" ? 1500 : false),
  });
}
