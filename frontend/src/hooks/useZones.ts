import { useQuery } from "@tanstack/react-query";
import { getZones } from "@/services/reference";

export function useZones() {
  return useQuery({ queryKey: ["zones"], queryFn: getZones });
}
