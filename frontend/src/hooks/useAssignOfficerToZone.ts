import { useMutation, useQueryClient } from "@tanstack/react-query";
import { assignOfficerToZone } from "@/services/admin";

export function useAssignOfficerToZone(zoneId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (officerId: string) => assignOfficerToZone(zoneId, { officerId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      queryClient.invalidateQueries({ queryKey: ["zones"] });
    },
  });
}
