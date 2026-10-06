import { useMutation, useQueryClient } from "@tanstack/react-query";
import { resetUserMfa } from "@/services/admin";

/** Admin clears someone's two-step verification (they lost their authenticator). */
export function useResetUserMfa(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => resetUserMfa(userId),
    onSuccess: () => {
      // The 2FA column on the users table changes.
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}
