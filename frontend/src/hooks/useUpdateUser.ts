import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateUser } from "@/services/admin";
import type { UpdateUserRequest } from "@/types/api";

export function useUpdateUser(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateUserRequest) => updateUser(userId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}
