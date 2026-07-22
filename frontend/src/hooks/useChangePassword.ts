import { useMutation } from "@tanstack/react-query";
import { changeMyPassword } from "@/services/account";

export function useChangePassword() {
  return useMutation({
    mutationFn: changeMyPassword,
  });
}
