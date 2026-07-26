import { useMutation, useQueryClient } from "@tanstack/react-query";
import { upvoteComplaint } from "@/services/complaints";

export function useUpvoteComplaint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (complaintId: string) => upvoteComplaint(complaintId),
    onSuccess: (_result, complaintId) => {
      queryClient.invalidateQueries({ queryKey: ["complaints", complaintId] });
      queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });
}
