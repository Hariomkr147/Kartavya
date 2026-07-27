import { useQuery } from "@tanstack/react-query";
import { getMyComplaints, type GetMyComplaintsParams } from "@/services/complaints";

/**
 * Refetches on window focus (the app-wide default is off): a citizen's own
 * complaints move because an officer acted elsewhere, so coming back to the
 * tab is exactly the moment the list is most likely to be out of date — and
 * it's what feeds the "what changed while you were away" diff.
 */
export function useMyComplaints(params: GetMyComplaintsParams = {}) {
  return useQuery({
    queryKey: ["complaints", "my", params],
    queryFn: () => getMyComplaints(params),
    refetchOnWindowFocus: true,
  });
}
