import { useQuery } from "@tanstack/react-query";
import { getOfficerQueue, type GetOfficerQueueParams } from "@/services/officer";

export function useOfficerQueue(params: GetOfficerQueueParams = {}) {
  return useQuery({
    queryKey: ["officer", "queue", params],
    queryFn: () => getOfficerQueue(params),
  });
}
