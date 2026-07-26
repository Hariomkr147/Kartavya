import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteZone } from "@/services/admin";

export function useDeleteZone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (zoneId: string) => deleteZone(zoneId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["zones"] });
    },
  });
}
