import { useQuery } from "@tanstack/react-query";
import { getClusters, type GetClustersParams } from "@/services/shared";

export function useClusters(params: GetClustersParams = {}) {
  return useQuery({
    queryKey: ["clusters", params],
    queryFn: () => getClusters(params),
  });
}
