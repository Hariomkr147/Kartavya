import { useMutation, useQueryClient } from "@tanstack/react-query";
import { reviewEvidence } from "@/services/officer";
import type { EvidenceReviewRequest } from "@/types/api";

export function useReviewEvidence(complaintId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: EvidenceReviewRequest) => reviewEvidence(complaintId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["complaints", complaintId] });
      queryClient.invalidateQueries({ queryKey: ["officer", "queue"] });
    },
  });
}
