import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addClusterProgressNote } from "@/services/officer";

export function useAddClusterProgressNote(clusterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => addClusterProgressNote(clusterId, { text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clusters", clusterId] });
      queryClient.invalidateQueries({ queryKey: ["officer", "queue"] });
    },
  });
}
