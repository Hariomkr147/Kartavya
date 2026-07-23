import { useQuery } from "@tanstack/react-query";
import { getAllComplaints, type GetAdminComplaintsParams } from "@/services/admin";

export function useAdminComplaints(params: GetAdminComplaintsParams = {}) {
  return useQuery({
    queryKey: ["admin", "complaints", params],
    queryFn: () => getAllComplaints(params),
  });
}
