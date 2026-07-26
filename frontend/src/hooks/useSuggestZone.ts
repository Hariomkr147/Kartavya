import { useMutation } from "@tanstack/react-query";
import { suggestZone } from "@/services/reference";

export function useSuggestZone() {
  return useMutation({ mutationFn: suggestZone });
}
