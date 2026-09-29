import { useMutation } from "@tanstack/react-query";
import { linkGoogle } from "@/services/account";
import { useAuth } from "@/contexts/AuthContext";

/** Links a Google account to the logged-in user — the only way staff start using Google. */
export function useLinkGoogle() {
  const { refreshUser } = useAuth();
  return useMutation({
    mutationFn: linkGoogle,
    onSuccess: () => refreshUser(),
  });
}
