import { useMutation, useQueryClient } from "@tanstack/react-query";
import { submitAdditionalEvidence } from "@/services/complaints";

export function useSubmitEvidence(complaintId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photo: File) => submitAdditionalEvidence(complaintId, photo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["complaints", complaintId] });
      queryClient.invalidateQueries({ queryKey: ["complaints", "my"] });
    },
  });
}
