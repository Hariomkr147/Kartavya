import { useQuery } from "@tanstack/react-query";
import { getComplaintById } from "@/services/complaints";
import type { ComplaintDetail, ComplaintStatus } from "@/types/api";

/** Terminal per `schema.dbml` — nothing can move these, so polling them is pure waste. */
const TERMINAL_STATUSES: ComplaintStatus[] = ["REJECTED", "CLOSED", "UNRESOLVABLE"];

const ACTIVE_POLL_MS = 60_000;

/**
 * A complaint's status is driven by an officer on the other side of the
 * system, so a detail page left open goes stale silently. While the
 * complaint is still live this re-reads it every minute and on window
 * focus; once it reaches a terminal status the polling stops.
 */
export function useComplaint(complaintId: string | undefined) {
  return useQuery({
    queryKey: ["complaints", complaintId],
    queryFn: () => getComplaintById(complaintId!),
    enabled: !!complaintId,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const current = query.state.data as ComplaintDetail | undefined;
      if (!current) return false;
      return TERMINAL_STATUSES.includes(current.status) ? false : ACTIVE_POLL_MS;
    },
  });
}
