import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createComplaint } from "@/services/complaints";

export function useCreateComplaint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createComplaint,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["complaints", "my"] });
      queryClient.invalidateQueries({ queryKey: ["gamification"] });
    },
  });
}
