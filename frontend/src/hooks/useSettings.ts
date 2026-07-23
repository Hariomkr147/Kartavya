import { useQuery } from "@tanstack/react-query";
import { getSettings } from "@/services/admin";

export function useSettings() {
  return useQuery({
    queryKey: ["admin", "settings"],
    queryFn: getSettings,
  });
}
