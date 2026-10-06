import { useMutation } from "@tanstack/react-query";
import { startMfaSetup } from "@/services/account";

/**
 * Begins turning on two-step verification. The response carries the secret
 * (as a QR URI and as text) — it is never returned again, so callers keep it
 * in component state only and never in a query cache.
 */
export function useStartMfaSetup() {
  return useMutation({ mutationFn: startMfaSetup });
}
