import { useMutation, useQueryClient } from "@tanstack/react-query";
import { batchUpdateStatus } from "@/services/officer";
import type { BatchStatusUpdateRequest } from "@/types/api";

export function useBatchUpdateStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BatchStatusUpdateRequest) => batchUpdateStatus(body),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["officer", "queue"] });
      queryClient.invalidateQueries({ queryKey: ["clusters"] });
      for (const item of result.results) {
        queryClient.invalidateQueries({ queryKey: ["complaints", item.complaintId] });
      }
    },
  });
}
