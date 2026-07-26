import { useQuery } from "@tanstack/react-query";
import { getAllComplaints } from "@/services/admin";

const DAY_LABEL = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * There's no time-series analytics endpoint in the contract, so this derives
 * a daily filed-complaints trend from `GET /admin/complaints` by issuing one
 * `pageSize: 1` request per day and reading `pagination.totalItems` — the
 * same "fetch a working set client-side" pattern the officer clusters/queue
 * pages already use for filters the contract doesn't expose directly.
 * Deliberately small `days` default: each extra day is another request.
 */
export function useComplaintVolumeTrend(days = 14) {
  return useQuery({
    queryKey: ["admin", "complaints", "volume-trend", days],
    queryFn: async () => {
      const today = new Date();
      const requests = Array.from({ length: days }, (_, i) => {
        const offset = days - 1 - i;
        const dayStart = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate() - offset,
          0,
          0,
          0,
          0,
        );
        const dayEnd = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate() - offset,
          23,
          59,
          59,
          999,
        );
        return getAllComplaints({
          dateFrom: dayStart.toISOString(),
          dateTo: dayEnd.toISOString(),
          pageSize: 1,
        }).then((res) => ({
          x: DAY_LABEL.format(dayStart),
          y: res.pagination.totalItems,
        }));
      });
      return Promise.all(requests);
    },
    staleTime: 5 * 60 * 1000,
  });
}
