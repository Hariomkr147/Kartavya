import { useState } from "react";
import { Trophy } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { cn } from "@/lib/utils";
import { RefreshButton } from "@/components/ui/RefreshButton";

const PAGE_SIZE = 20;

export function AdminLeaderboardPage() {
  const [period, setPeriod] = useState<"monthly" | "all_time">("monthly");
  const [page, setPage] = useState(1);

  // Admins have no zoneId, so `scope=zone` isn't meaningful for this
  // account — only the city-wide ranking is offered here.
  const {
    data: leaderboard,
    isLoading,
    isFetching,
    refetch,
  } = useLeaderboard({
    scope: "city",
    period,
    page,
    pageSize: PAGE_SIZE,
  });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-display-sm font-semibold text-ink">
              Leaderboard
            </h1>
            <RefreshButton
              onRefresh={refetch}
              refreshing={isFetching}
              what="the leaderboard"
            />
          </div>
          <p className="text-ink-muted mt-1 text-sm">
            City-wide citizen rankings by civic service points.
          </p>
        </div>
        <Tabs
          value={period}
          onValueChange={(v) => {
            setPeriod(v as "monthly" | "all_time");
            setPage(1);
          }}
        >
          <TabsList>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
            <TabsTrigger value="all_time">All-time</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : !leaderboard || leaderboard.data.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="No leaderboard activity yet"
          description="Rankings appear once citizens start earning points."
          className="rounded-lg border border-line bg-surface"
        />
      ) : (
        <>
          <div className="divide-y divide-line rounded-lg border border-line bg-surface">
            {leaderboard.data.map((entry) => (
              <div key={entry.citizenId} className="flex items-center gap-3 px-4 py-3">
                <span
                  className={cn(
                    "w-8 shrink-0 font-mono text-sm font-semibold",
                    entry.isTopThree ? "text-csp" : "text-ink-faint",
                  )}
                >
                  #{entry.rank}
                </span>
                <p className="flex-1 truncate text-sm font-medium text-ink">
                  {entry.displayName ?? `Citizen #${entry.citizenId}`}
                </p>
                <p className="font-mono text-sm font-semibold text-ink">{entry.points}</p>
              </div>
            ))}
          </div>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={leaderboard.pagination.totalItems}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
