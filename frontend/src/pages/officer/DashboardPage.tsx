import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Clock,
  Radio,
  RefreshCcw,
  RefreshCw,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { LinkButton } from "@/components/ui/LinkButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ComplaintListItem } from "@/components/complaint/ComplaintListItem";
import { StatCard } from "@/components/dashboard/StatCard";
import { RecentlyViewedList } from "@/components/dashboard/RecentlyViewedList";
import { OfficerUpdatesCard } from "@/components/dashboard/OfficerUpdatesCard";
import { HorizontalBarChart } from "@/components/charts/HorizontalBarChart";
import { formatFullDate } from "@/lib/greeting";
import { staggerContainer, staggerItem } from "@/lib/motionVariants";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useOfficerAnalytics } from "@/hooks/useOfficerAnalytics";
import { useZoneSummary } from "@/hooks/useZoneSummary";
import { useOfficerQueue } from "@/hooks/useOfficerQueue";
import { useOfficerQueueUpdates } from "@/hooks/useOfficerQueueUpdates";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import type { ComplaintStatus } from "@/types/api";

const ATTENTION_STATUSES: ComplaintStatus[] = [
  "SUBMITTED",
  "EVIDENCE_UNDER_REVIEW",
  "NEEDS_MORE_EVIDENCE",
  "UNDER_REVIEW",
  "IN_PROGRESS",
  "UNDER_RESOLUTION",
];

// The summary strip below counts "assigned to you" and "updated today"
// client-side, because `/officer/complaints` exposes no assignee or date
// filter to count them server-side. So it fetches a generously sized working
// set once (same FETCH_SIZE pattern the officer queue uses) and counts over
// that, rather than over the five rows the "Needs attention" list shows —
// counting a 5-row page would cap every figure at 5. The unassigned count
// doesn't need this: `status=SUBMITTED` is exactly the unclaimed set, so it
// comes from the server's own `totalItems` and is exact at any scale.
const FETCH_SIZE = 100;
const PRIORITY_PREVIEW_COUNT = 5;

type AnalyticsPeriod = "all_time" | "this_month" | "last_30_days" | "last_7_days";

const PERIOD_OPTIONS: { value: AnalyticsPeriod; label: string }[] = [
  { value: "all_time", label: "All time" },
  { value: "this_month", label: "This month" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_7_days", label: "Last 7 days" },
];

/** Maps a period choice onto the `dateFrom`/`dateTo` params `/officer/analytics`
 * already accepts. "All time" sends neither, which is the endpoint's default. */
function periodToRange(period: AnalyticsPeriod): { dateFrom?: string; dateTo?: string } {
  if (period === "all_time") return {};
  const now = new Date();
  if (period === "this_month") {
    return { dateFrom: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() };
  }
  const days = period === "last_30_days" ? 30 : 7;
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return { dateFrom: from.toISOString() };
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function OfficerDashboardPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<AnalyticsPeriod>("all_time");
  const analyticsParams = useMemo(() => periodToRange(period), [period]);
  const {
    data: analytics,
    isLoading: analyticsLoading,
    isFetching: analyticsFetching,
    refetch: refetchAnalytics,
  } = useOfficerAnalytics(analyticsParams);
  const { data: zoneSummary } = useZoneSummary(user?.zoneId);
  const { data: queueData, isLoading: queueLoading } = useOfficerQueue({
    status: ATTENTION_STATUSES,
    pageSize: FETCH_SIZE,
  });
  // Exact unclaimed count — SUBMITTED is precisely the not-yet-claimed set,
  // so the server's own total answers this without loading any rows.
  const { data: unassignedData } = useOfficerQueue({
    status: ["SUBMITTED"],
    pageSize: 1,
  });
  const { items: recentItems, clear: clearRecent } = useRecentlyViewed(
    `officer:${user?.id ?? "anon"}`,
  );
  const { updates, acknowledge: acknowledgeUpdates } = useOfficerQueueUpdates();

  const activeQueue = useMemo(() => queueData?.data ?? [], [queueData]);
  const priorityItems = activeQueue.slice(0, PRIORITY_PREVIEW_COUNT);

  const assignedToYouCount = activeQueue.filter(
    (c) => c.assignedOfficerId === user?.id,
  ).length;
  const unassignedCount = unassignedData?.pagination.totalItems ?? 0;
  const updatedTodayCount = activeQueue.filter(
    (c) => c.updatedAt && isToday(c.updatedAt),
  ).length;

  const categoryChartData = (analytics?.categoryBreakdown ?? [])
    .filter((item) => item.categoryName != null && item.count != null)
    .map((item) => ({ label: item.categoryName!, value: item.count! }));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-ink-faint text-sm font-medium">{formatFullDate()}</p>
          <h1 className="font-display text-display-sm mt-0.5 font-semibold text-ink">
            {analytics?.zoneName ?? "Zone"} Dashboard
          </h1>
          <p className="text-ink-muted mt-1 text-sm">
            Live status for your assigned zone — most urgent complaints first.
          </p>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-ink-muted bg-surface-hover inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium">
            <Radio className="text-status-resolved size-3.5 shrink-0" aria-hidden="true" />
            Live
          </span>
          <div className="w-40">
            <Combobox
              id="officer-analytics-period"
              aria-label="Analytics period"
              value={period}
              onChange={(v) => setPeriod(v as AnalyticsPeriod)}
              options={PERIOD_OPTIONS}
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Refresh now"
            onClick={() => refetchAnalytics()}
            className="size-8"
          >
            <RefreshCw
              className={cn("size-4", analyticsFetching && "animate-spin")}
              aria-hidden="true"
            />
          </Button>
        </div>
      </div>

      <OfficerUpdatesCard updates={updates} onDismiss={acknowledgeUpdates} />

      {analyticsLoading ? (
        <div className="grid gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="grid gap-4 sm:grid-cols-4"
        >
          <StatCard
            icon={ClipboardList}
            label="Active complaints"
            value={analytics?.activeComplaints ?? 0}
          />
          <StatCard
            icon={AlertTriangle}
            label="Overdue"
            value={analytics?.overdueCount ?? 0}
            accent={
              analytics?.overdueCount && analytics.overdueCount > 0 ? "bad" : "brand"
            }
          />
          <StatCard
            icon={Boxes}
            label="Active clusters"
            value={zoneSummary?.activeClusters ?? 0}
          />
          <StatCard
            icon={Clock}
            label="Avg. resolution (this month)"
            value={
              analytics?.avgResolutionHoursThisMonth != null
                ? `${Math.round(analytics.avgResolutionHoursThisMonth)}h`
                : "—"
            }
          />
        </motion.div>
      )}

      {period !== "all_time" && (
        <p className="text-ink-faint -mt-4 text-xs">
          Active and Overdue count complaints filed in the selected period. Active
          clusters and average resolution ignore it — clusters are a live count, and
          the contract pins average resolution to the current calendar month.
        </p>
      )}

      {!queueLoading && priorityItems.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-surface px-5 py-3"
        >
          <p className="text-ink-faint text-xs font-medium tracking-wide uppercase">
            Your active queue
          </p>
          <Link
            to="/officer/queue?tab=mine"
            className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-sm hover:underline"
          >
            <UserCheck className="text-brand size-4" aria-hidden="true" />
            {assignedToYouCount} assigned to you
          </Link>
          <Link
            to="/officer/queue?tab=unassigned"
            className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 text-sm hover:underline"
          >
            <CircleDot className="text-ink-faint size-4" aria-hidden="true" />
            {unassignedCount} unassigned
          </Link>
          <span className="text-ink-muted inline-flex items-center gap-1.5 text-sm">
            <RefreshCcw className="text-ink-faint size-4" aria-hidden="true" />
            {updatedTodayCount} updated today
          </span>
        </motion.div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-ink">
              Needs attention
            </h2>
            <LinkButton to="/officer/queue" variant="ghost" size="sm">
              Open queue
              <ArrowRight className="size-4" aria-hidden="true" />
            </LinkButton>
          </div>

          {queueLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-[4.5rem] w-full" />
              <Skeleton className="h-[4.5rem] w-full" />
              <Skeleton className="h-[4.5rem] w-full" />
            </div>
          ) : priorityItems.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Nothing urgent"
              description="Your zone's queue is caught up — nice work."
              className="rounded-lg border border-line bg-surface"
            />
          ) : (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="show"
              className="space-y-2"
            >
              {priorityItems.map((c) => (
                <motion.div key={c.id} variants={staggerItem}>
                  <ComplaintListItem complaint={c} to={`/officer/queue/${c.id}`} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-line bg-surface p-5">
            <div className="flex items-center gap-2">
              <Boxes className="text-brand size-5" aria-hidden="true" />
              <p className="font-display text-base font-semibold text-ink">Clusters</p>
            </div>
            <p className="text-ink mt-3 font-mono text-3xl font-semibold">
              {zoneSummary?.activeClusters ?? 0}
            </p>
            <p className="text-ink-muted mt-1 text-sm">
              active of {zoneSummary?.totalClusters ?? 0} total
            </p>
            <LinkButton
              to="/officer/clusters"
              variant="outline"
              size="sm"
              className="mt-4 w-full"
            >
              View clusters
            </LinkButton>
          </div>

          <div className="rounded-lg border border-line bg-surface p-5">
            <p className="font-display text-base font-semibold text-ink">Zone totals</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">Total complaints</dt>
                <dd className="font-medium text-ink">
                  {zoneSummary?.totalComplaints ?? 0}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Resolved</dt>
                <dd className="font-medium text-ink">
                  {zoneSummary?.resolvedComplaints ?? 0}
                </dd>
              </div>
            </dl>
          </div>

          {categoryChartData.length > 0 && (
            <div className="rounded-lg border border-line bg-surface p-5">
              <p className="font-display text-base font-semibold text-ink">By category</p>
              <HorizontalBarChart data={categoryChartData} className="mt-3" />
            </div>
          )}

          <RecentlyViewedList items={recentItems} onClear={clearRecent} />
        </aside>
      </div>
    </div>
  );
}
