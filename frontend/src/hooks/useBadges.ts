import { useQuery } from "@tanstack/react-query";
import { getMyBadges } from "@/services/gamification";

export function useBadges() {
  return useQuery({
    queryKey: ["gamification", "badges"],
    queryFn: getMyBadges,
  });
}
