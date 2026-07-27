import { useMutation, useQueryClient } from "@tanstack/react-query";
import { upvoteComplaint } from "@/services/complaints";

/**
 * Upvoting can legitimately fail — the contract 403s your own complaint or
 * another zone's, and 409s one you already backed or one that is already
 * closed. Invalidation therefore runs `onSettled`, not `onSuccess`: after a
 * rejection the cached feed is exactly what needs re-reading, so the card
 * resyncs with the server's truth instead of keeping a count the server
 * never accepted. Callers surface the message; the returned `UpvoteResult`
 * carries the authoritative new count and severity label.
 */
export function useUpvoteComplaint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (complaintId: string) => upvoteComplaint(complaintId),
    onSettled: (_result, _error, complaintId) => {
      queryClient.invalidateQueries({ queryKey: ["complaints", complaintId] });
      queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
  });
}
