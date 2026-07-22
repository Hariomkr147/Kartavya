import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createUser } from "@/services/admin";

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}
