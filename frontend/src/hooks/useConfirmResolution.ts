import { useMutation, useQueryClient } from "@tanstack/react-query";
import { confirmResolution } from "@/services/complaints";

export function useConfirmResolution(complaintId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => confirmResolution(complaintId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["complaints", complaintId] });
      queryClient.invalidateQueries({ queryKey: ["complaints", "my"] });
      queryClient.invalidateQueries({ queryKey: ["gamification"] });
    },
  });
}
