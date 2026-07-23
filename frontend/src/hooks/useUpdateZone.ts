import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateZone } from "@/services/admin";
import type { UpdateZoneRequest } from "@/types/api";

export function useUpdateZone(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateZoneRequest) => updateZone(zoneId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["zones"] });
    },
  });
}
