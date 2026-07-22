import { useMutation, useQueryClient } from "@tanstack/react-query";
import { disputeResolution } from "@/services/complaints";

export function useDisputeResolution(complaintId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ reason, photo }: { reason: string; photo: File }) =>
      disputeResolution(complaintId, reason, photo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["complaints", complaintId] });
      queryClient.invalidateQueries({ queryKey: ["complaints", "my"] });
    },
  });
}
