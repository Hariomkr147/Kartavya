import { useMutation } from "@tanstack/react-query";
import { disableMfa } from "@/services/account";
import { useAuth } from "@/contexts/AuthContext";

/** Needs a current code, so a stolen session alone cannot remove the second step. */
export function useDisableMfa() {
  const { refreshUser } = useAuth();
  return useMutation({
    mutationFn: disableMfa,
    onSuccess: () => refreshUser(),
  });
}
