import { useQuery } from "@tanstack/react-query";
import { getAllUsers, type GetAllUsersParams } from "@/services/admin";

export function useAdminUsers(params: GetAllUsersParams = {}) {
  return useQuery({
    queryKey: ["admin", "users", params],
    queryFn: () => getAllUsers(params),
  });
}
