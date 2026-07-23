import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, Award, ListChecks, TrendingUp, PieChart } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { Tooltip } from "@/components/ui/Tooltip";
import { DynamicIcon } from "@/components/DynamicIcon";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import {
  HorizontalBarChart,
  type BarDatum,
} from "@/components/charts/HorizontalBarChart";
import { iconForBadge } from "@/lib/badgeIcons";
import { relativeTime, absoluteDateTime } from "@/lib/datetime";
import { usePointsSummary } from "@/hooks/usePointsSummary";
import { useBadges } from "@/hooks/useBadges";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { cn } from "@/lib/utils";
import type { PointsLedgerEntry } from "@/types/api";

const LEDGER_PAGE_SIZE = 8;
// A single larger fetch (mirrors the same "adjust the existing call's
// params" pattern used elsewhere) so the trend chart and reason breakdown
// have enough history to be meaningful — the ledger table below then
// paginates client-side over this same fetched set instead of relying on
// the server's page/pageSize for it.
const LEDGER_FETCH_SIZE = 100;
const LEADERBOARD_PAGE_SIZE = 10;

const REASON_LABELS: Record<PointsLedgerEntry["reason"], string> = {
  COMPLAINT_CLOSED: "Complaint closed",
  CLUSTER_MEMBER_CLOSED: "Cluster member closed",
  FIRST_COMPLAINT: "First complaint bonus",
  ON_TIME_BONUS: "On-time bonus",
  UPVOTE_RECEIVED: "Upvote received",
  REJECTED_PENALTY: "Complaint rejected",
};

const shortDateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});

function cumulativeSeries(ledger: PointsLedgerEntry[]) {
  const chronological = [...ledger].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  let running = 0;
  return chronological.map((entry) => {
    running += entry.amount;
    return { x: shortDateFormatter.format(new Date(entry.createdAt)), y: running };
  });
}

function reasonBreakdown(ledger: PointsLedgerEntry[]): BarDatum[] {
  const sums = new Map<PointsLedgerEntry["reason"], number>();
  for (const entry of ledger) {
    sums.set(entry.reason, (sums.get(entry.reason) ?? 0) + entry.amount);
  }
  return [...sums.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, value]) => ({ label: REASON_LABELS[reason], value }));
}

export function GamificationPage() {
  const [ledgerPage, setLedgerPage] = useState(1);
  const [scope, setScope] = useState<"zone" | "city">("zone");
  const [period, setPeriod] = useState<"monthly" | "all_time">("monthly");
  const [leaderboardPage, setLeaderboardPage] = useState(1);

  const { data: points, isLoading: pointsLoading } = usePointsSummary({
    pageSize: LEDGER_FETCH_SIZE,
  });
  const { data: badges, isLoading: badgesLoading } = useBadges();
  const { data: leaderboard, isLoading: leaderboardLoading } = useLeaderboard({
    scope,
    period,
    page: leaderboardPage,
    pageSize: LEADERBOARD_PAGE_SIZE,
  });

  const ledger = useMemo(() => points?.ledger ?? [], [points]);
  const ledgerTotal = ledger.length;
  const pagedLedger = ledger.slice(
    (ledgerPage - 1) * LEDGER_PAGE_SIZE,
    ledgerPage * LEDGER_PAGE_SIZE,
  );
  const trendData = useMemo(() => cumulativeSeries(ledger), [ledger]);
  const breakdownData = useMemo(() => reasonBreakdown(ledger), [ledger]);
  const currentUserVisible = leaderboard?.data.some((e) => e.isCurrentUser) ?? false;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <h1 className="font-display text-display-sm font-semibold text-ink">My Kartavya</h1>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-line bg-surface p-5">
          <div className="flex items-center gap-2">
            <Trophy className="text-csp size-5" aria-hidden="true" />
            <p className="font-display text-base font-semibold text-ink">
              Civic Service Points
            </p>
          </div>
          <div className="mt-3 flex items-baseline gap-4">
            <div>
              <p className="text-csp font-mono text-3xl font-semibold">
                {points?.totalLifetimeCsp ?? 0}
              </p>
              <p className="text-ink-faint text-xs">Lifetime</p>
            </div>
            <div>
              <p className="font-mono text-xl font-semibold text-ink">
                +{points?.currentMonthCsp ?? 0}
              </p>
              <p className="text-ink-faint text-xs">This month</p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-line bg-surface p-5">
          <div className="flex items-center gap-2">
            <Award className="text-brand size-5" aria-hidden="true" />
            <p className="font-display text-base font-semibold text-ink">Badges</p>
          </div>
          {badgesLoading ? (
            <div className="mt-3 flex gap-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="size-14 rounded-full" />
              ))}
            </div>
          ) : !badges || badges.length === 0 ? (
            <p className="text-ink-muted mt-3 text-sm">
              No badges earned yet — file and see complaints through to resolution to
              start earning them.
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-4">
              {badges.map((badge) => (
                <Tooltip key={badge.code} content={badge.description ?? badge.name}>
                  <button
                    type="button"
                    className="flex w-20 flex-col items-center gap-1.5 text-center"
                  >
                    <span className="bg-brand/10 text-brand flex size-14 items-center justify-center rounded-full">
                      <DynamicIcon
                        icon={iconForBadge(badge.code)}
                        className="size-6"
                        aria-hidden="true"
                      />
                    </span>
                    <p className="text-xs leading-tight font-medium text-ink">
                      {badge.name}
                    </p>
                    <p className="text-ink-faint text-[10px]">
                      {relativeTime(badge.earnedAt)}
                    </p>
                  </button>
                </Tooltip>
              ))}
            </div>
          )}
        </section>
      </div>

      {!pointsLoading && ledger.length > 0 && (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <section className="rounded-lg border border-line bg-surface p-5">
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp className="text-ink-muted size-4" aria-hidden="true" />
              <h2 className="font-display text-sm font-semibold text-ink">
                CSP over time
              </h2>
            </div>
            <TrendLineChart data={trendData} color="var(--color-csp)" />
          </section>
          <section className="rounded-lg border border-line bg-surface p-5">
            <div className="mb-3 flex items-center gap-2">
              <PieChart className="text-ink-muted size-4" aria-hidden="true" />
              <h2 className="font-display text-sm font-semibold text-ink">
                Points by reason
              </h2>
            </div>
            <HorizontalBarChart data={breakdownData} color="var(--color-csp)" />
          </section>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ListChecks className="text-ink-muted size-5" aria-hidden="true" />
          <h2 className="font-display text-lg font-semibold text-ink">Points ledger</h2>
        </div>
        {pointsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : ledger.length === 0 ? (
          <EmptyState
            title="No point activity yet"
            description="Points show up here as your complaints move through their lifecycle."
            className="rounded-lg border border-line bg-surface"
          />
        ) : (
          <>
            <div className="divide-y divide-line rounded-lg border border-line bg-surface">
              {pagedLedger.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {entry.complaintId ? (
                        <Link
                          to={`/citizen/complaints/${entry.complaintId}`}
                          className="hover:text-brand hover:underline"
                        >
                          {REASON_LABELS[entry.reason]}
                        </Link>
                      ) : (
                        REASON_LABELS[entry.reason]
                      )}
                    </p>
                    <p className="text-ink-faint text-xs">
                      {absoluteDateTime(entry.createdAt)}
                      {entry.complaintId && ` · ${entry.complaintId}`}
                    </p>
                  </div>
                  <p
                    className={cn(
                      "font-mono text-sm font-semibold",
                      entry.amount >= 0 ? "text-status-resolved" : "text-status-rejected",
                    )}
                  >
                    {entry.amount >= 0 ? "+" : ""}
                    {entry.amount}
                  </p>
                </div>
              ))}
            </div>
            <Pagination
              page={ledgerPage}
              pageSize={LEDGER_PAGE_SIZE}
              total={ledgerTotal}
              onPageChange={setLedgerPage}
            />
          </>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-ink">Leaderboard</h2>
          <div className="flex flex-wrap gap-2">
            <Tabs
              value={scope}
              onValueChange={(v) => {
                setScope(v as "zone" | "city");
                setLeaderboardPage(1);
              }}
            >
              <TabsList>
                <TabsTrigger value="zone">My zone</TabsTrigger>
                <TabsTrigger value="city">City-wide</TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs
              value={period}
              onValueChange={(v) => {
                setPeriod(v as "monthly" | "all_time");
                setLeaderboardPage(1);
              }}
            >
              <TabsList>
                <TabsTrigger value="monthly">Monthly</TabsTrigger>
                <TabsTrigger value="all_time">All-time</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {leaderboardLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : !leaderboard || leaderboard.data.length === 0 ? (
          <EmptyState
            title="No leaderboard activity yet"
            description="Rankings appear once citizens start earning points in this scope."
            className="rounded-lg border border-line bg-surface"
          />
        ) : (
          <>
            <div className="divide-y divide-line rounded-lg border border-line bg-surface">
              {leaderboard.data.map((entry) => (
                <div
                  key={entry.citizenId}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3",
                    entry.isCurrentUser && "bg-brand/5",
                  )}
                >
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
                    {entry.isCurrentUser && (
                      <span className="text-brand ml-2 text-xs font-normal">(you)</span>
                    )}
                  </p>
                  <p className="font-mono text-sm font-semibold text-ink">
                    {entry.points}
                  </p>
                </div>
              ))}
            </div>
            {leaderboard.currentUser && !currentUserVisible && (
              <div className="border-brand/30 bg-brand/5 flex items-center gap-3 rounded-lg border px-4 py-3">
                <span className="text-brand w-8 shrink-0 font-mono text-sm font-semibold">
                  #{leaderboard.currentUser.rank}
                </span>
                <p className="flex-1 truncate text-sm font-medium text-ink">
                  {leaderboard.currentUser.displayName ??
                    `Citizen #${leaderboard.currentUser.citizenId}`}
                  <span className="text-brand ml-2 text-xs font-normal">(you)</span>
                </p>
                <p className="font-mono text-sm font-semibold text-ink">
                  {leaderboard.currentUser.points}
                </p>
              </div>
            )}
            <Pagination
              page={leaderboardPage}
              pageSize={LEADERBOARD_PAGE_SIZE}
              total={leaderboard.pagination.totalItems}
              onPageChange={setLeaderboardPage}
            />
          </>
        )}
      </section>
    </div>
  );
}
