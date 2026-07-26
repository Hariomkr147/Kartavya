import { useMutation, useQueryClient } from "@tanstack/react-query";
import { reviewDispute } from "@/services/admin";
import type { DisputeReviewRequest } from "@/types/api";

export function useReviewDispute(complaintId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DisputeReviewRequest) => reviewDispute(complaintId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["complaints", complaintId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "complaints"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "analytics"] });
    },
  });
}
