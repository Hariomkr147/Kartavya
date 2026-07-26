import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addProgressNote } from "@/services/officer";

export function useAddProgressNote(complaintId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => addProgressNote(complaintId, { text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["complaints", complaintId] });
    },
  });
}
