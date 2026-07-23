import { useQuery } from "@tanstack/react-query";
import { getMyComplaints, type GetMyComplaintsParams } from "@/services/complaints";

export function useMyComplaints(params: GetMyComplaintsParams = {}) {
  return useQuery({
    queryKey: ["complaints", "my", params],
    queryFn: () => getMyComplaints(params),
  });
}
