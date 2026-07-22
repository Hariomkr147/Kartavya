import { useMutation } from "@tanstack/react-query";
import { updateMyProfile } from "@/services/account";
import { useAuth } from "@/contexts/AuthContext";

export function useUpdateProfile() {
  const { refreshUser } = useAuth();
  return useMutation({
    mutationFn: updateMyProfile,
    onSuccess: () => refreshUser(),
  });
}
