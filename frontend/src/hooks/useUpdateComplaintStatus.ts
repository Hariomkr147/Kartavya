import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateComplaintStatus } from "@/services/officer";
import type { StatusUpdateRequest } from "@/types/api";

export function useUpdateComplaintStatus(complaintId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: StatusUpdateRequest) => updateComplaintStatus(complaintId, body),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["complaints", complaintId] });
      queryClient.invalidateQueries({ queryKey: ["officer", "queue"] });
      queryClient.invalidateQueries({ queryKey: ["clusters"] });
      // A RESOLVED move can cascade other cluster members — invalidate their
      // detail queries too so an already-open tab picks up the SYSTEM change.
      for (const item of result.cascade ?? []) {
        queryClient.invalidateQueries({ queryKey: ["complaints", item.complaintId] });
      }
    },
  });
}
