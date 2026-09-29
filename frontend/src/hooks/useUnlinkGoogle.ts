import { useMutation } from "@tanstack/react-query";
import { unlinkGoogle } from "@/services/account";
import { useAuth } from "@/contexts/AuthContext";

export function useUnlinkGoogle() {
  const { refreshUser } = useAuth();
  return useMutation({
    mutationFn: unlinkGoogle,
    onSuccess: () => refreshUser(),
  });
}
