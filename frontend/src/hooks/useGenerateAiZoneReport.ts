import { useMutation, useQueryClient } from "@tanstack/react-query";
import { generateAiZoneReport } from "@/services/admin";

export function useGenerateAiZoneReport(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => generateAiZoneReport(zoneId),
    onSuccess: (report) => {
      queryClient.setQueryData(["admin", "zones", zoneId, "ai-report"], report);
    },
  });
}
