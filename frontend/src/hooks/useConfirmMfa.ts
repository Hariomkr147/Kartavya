import { useMutation } from "@tanstack/react-query";
import { confirmMfaSetup } from "@/services/account";
import { useAuth } from "@/contexts/AuthContext";

/** The first right code turns two-step verification on; refreshes the cached profile. */
export function useConfirmMfa() {
  const { refreshUser } = useAuth();
  return useMutation({
    mutationFn: confirmMfaSetup,
    onSuccess: () => refreshUser(),
  });
}
