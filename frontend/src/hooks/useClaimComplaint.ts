import { useMutation, useQueryClient } from "@tanstack/react-query";
import { claimComplaint } from "@/services/officer";

export function useClaimComplaint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (complaintId: string) => claimComplaint(complaintId),
    onSuccess: (complaint) => {
      queryClient.invalidateQueries({ queryKey: ["officer", "queue"] });
      queryClient.invalidateQueries({ queryKey: ["complaints", complaint.id] });
    },
  });
}
