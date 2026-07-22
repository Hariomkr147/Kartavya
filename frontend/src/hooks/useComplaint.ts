import { useQuery } from "@tanstack/react-query";
import { getComplaintById } from "@/services/complaints";

export function useComplaint(complaintId: string | undefined) {
  return useQuery({
    queryKey: ["complaints", complaintId],
    queryFn: () => getComplaintById(complaintId!),
    enabled: !!complaintId,
  });
}
