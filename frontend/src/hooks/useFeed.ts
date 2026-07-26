import { useQuery } from "@tanstack/react-query";
import { getFeed, type GetFeedParams } from "@/services/feed";

export function useFeed(params: GetFeedParams = {}) {
  return useQuery({
    queryKey: ["feed", params],
    queryFn: () => getFeed(params),
  });
}
