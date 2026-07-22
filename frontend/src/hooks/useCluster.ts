import { useQuery } from "@tanstack/react-query";
import { getClusterById } from "@/services/shared";

export function useCluster(clusterId: string | null | undefined) {
  return useQuery({
    queryKey: ["clusters", clusterId],
    queryFn: () => getClusterById(clusterId!),
    enabled: !!clusterId,
  });
}
