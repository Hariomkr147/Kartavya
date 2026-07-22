import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateSla } from "@/services/admin";

export function useUpdateSla(categoryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (targetHours: number) => updateSla(categoryId, { targetHours }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}
