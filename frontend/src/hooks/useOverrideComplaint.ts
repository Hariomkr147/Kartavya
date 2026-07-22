import { useMutation, useQueryClient } from "@tanstack/react-query";
import { overrideComplaint } from "@/services/admin";
import type { ComplaintOverrideRequest } from "@/types/api";

export function useOverrideComplaint(complaintId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ComplaintOverrideRequest) => overrideComplaint(complaintId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["complaints", complaintId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "complaints"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "analytics"] });
    },
  });
}
