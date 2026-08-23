import { useMutation } from "@tanstack/react-query";
import { resetUserPassword } from "@/services/admin";
import type { AdminResetPasswordRequest } from "@/types/api";

/**
 * Admin sets a new password on someone else's account.
 *
 * Nothing to invalidate: a password is not part of any cached `User`, and the
 * reset changes nothing else about the account.
 */
export function useResetUserPassword(userId: string) {
  return useMutation({
    mutationFn: (body: AdminResetPasswordRequest) => resetUserPassword(userId, body),
  });
}
