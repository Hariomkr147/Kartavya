import { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  FilePlus2,
  MapPinned,
  Rss,
  Tag,
  Trophy,
} from "lucide-react";
import { LinkButton } from "@/components/ui/LinkButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ComplaintListItem } from "@/components/complaint/ComplaintListItem";
import { StatCard } from "@/components/dashboard/StatCard";
import { AnimatedNumber } from "@/components/dashboard/AnimatedNumber";
import { RecentlyViewedList } from "@/components/dashboard/RecentlyViewedList";
import {
  HorizontalBarChart,
  type BarDatum,
} from "@/components/charts/HorizontalBarChart";
import { useAuth } from "@/contexts/AuthContext";
import { useMyComplaints } from "@/hooks/useMyComplaints";
import { usePointsSummary } from "@/hooks/usePointsSummary";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { staggerContainer, staggerItem } from "@/lib/motionVariants";
import { formatFullDate, timeOfDayGreeting } from "@/lib/greeting";
import type { Complaint, ComplaintStatus } from "@/types/api";

function topBreakdown(
  complaints: Complaint[],
  keyOf: (c: Complaint) => string | undefined,
): BarDatum[] {
  const counts = new Map<string, number>();
  for (const c of complaints) {
    const key = keyOf(c);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value]) => ({ label, value }));
}

// A generously-sized single fetch (matches the officer queue's FETCH_SIZE
// pattern) so the stat tiles below reflect the citizen's *entire* history,
// not just the most recent page — demo-scale trade-off, not a general one.
const FETCH_SIZE = 100;

const ACTIVE_STATUSES = new Set<ComplaintStatus>([
  "SUBMITTED",
  "EVIDENCE_UNDER_REVIEW",
  "NEEDS_MORE_EVIDENCE",
  "UNDER_REVIEW",
  "IN_PROGRESS",
  "UNDER_RESOLUTION",
  "REOPENED",
]);
const RESOLVED_STATUSES = new Set<ComplaintStatus>(["RESOLVED", "CLOSED"]);

export function CitizenDashboardPage() {
  const { user } = useAuth();
  const { data, isLoading } = useMyComplaints({
    pageSize: FETCH_SIZE,
    sort: "-createdAt",
  });
  const { data: points, isLoading: pointsLoading } = usePointsSummary();
  const { items: recentlyViewed, clear: clearRecentlyViewed } = useRecentlyViewed(
    `citizen:${user?.id ?? "anon"}`,
  );

  const complaints = useMemo(() => data?.data ?? [], [data]);
  const actionNeeded = complaints.filter((c) => c.citizenActionNeeded);
  const recent = complaints.slice(0, 5);
  const activeCount = complaints.filter((c) => ACTIVE_STATUSES.has(c.status)).length;
  const resolvedCount = complaints.filter((c) => RESOLVED_STATUSES.has(c.status)).length;

  const categoryBreakdown = useMemo(
    () => topBreakdown(complaints, (c) => c.category.name),
    [complaints],
  );
  const zoneBreakdown = useMemo(
    () => topBreakdown(complaints, (c) => c.zoneName),
    [complaints],
  );

  const firstName = user?.displayName || user?.name?.split(" ")[0];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-ink-faint text-sm font-medium">{formatFullDate()}</p>
          <h1 className="font-display text-display-sm mt-0.5 font-semibold text-ink">
            {timeOfDayGreeting()}, {firstName}
          </h1>
          <p className="text-ink-muted mt-1 text-sm">
            Here's what's happening with your reports.
          </p>
        </div>
        <LinkButton to="/citizen/file" size="lg">
          <FilePlus2 className="size-4" aria-hidden="true" />
          File a complaint
        </LinkButton>
      </div>

      {isLoading ? (
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
          <Link
            to="/citizen/complaints?bucket=active"
            className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            aria-label={`View ${activeCount} active complaints`}
          >
            <StatCard
              icon={ClipboardList}
              label="Active complaints"
              value={activeCount}
            />
          </Link>
          <Link
            to="/citizen/complaints?bucket=resolved"
            className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            aria-label={`View ${resolvedCount} resolved complaints`}
          >
            <StatCard
              icon={CheckCircle2}
              label="Resolved"
              value={resolvedCount}
              accent="good"
            />
          </Link>
          <StatCard
            icon={CircleAlert}
            label="Needs your attention"
            value={actionNeeded.length}
            accent={actionNeeded.length > 0 ? "warning" : "brand"}
          />
          <StatCard
            icon={Trophy}
            label="Civic Service Points"
            value={points?.totalLifetimeCsp ?? 0}
            accent="csp"
          />
        </motion.div>
      )}

      {actionNeeded.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-lg border border-status-needs_more_evidence/30 bg-status-needs_more_evidence-subtle p-4"
        >
          <div className="mb-3 flex items-center gap-2">
            <CircleAlert
              className="text-status-needs_more_evidence size-5"
              aria-hidden="true"
            />
            <p className="font-display text-base font-semibold text-ink">
              {actionNeeded.length === 1
                ? "1 complaint needs"
                : `${actionNeeded.length} complaints need`}{" "}
              your attention
            </p>
          </div>
          <div className="space-y-2">
            {actionNeeded.map((c) => (
              <ComplaintListItem
                key={c.id}
                complaint={c}
                to={`/citizen/complaints/${c.id}`}
              />
            ))}
          </div>
        </motion.section>
      )}

      {!isLoading &&
        complaints.length > 0 &&
        (categoryBreakdown.length > 0 || zoneBreakdown.length > 0) && (
          <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
            {categoryBreakdown.length > 0 && (
              <section className="rounded-lg border border-line bg-surface p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Tag className="text-ink-muted size-4" aria-hidden="true" />
                  <h2 className="font-display text-sm font-semibold text-ink">
                    By category
                  </h2>
                </div>
                <HorizontalBarChart data={categoryBreakdown} />
              </section>
            )}
            {zoneBreakdown.length > 0 && (
              <section className="rounded-lg border border-line bg-surface p-5">
                <div className="mb-3 flex items-center gap-2">
                  <MapPinned className="text-ink-muted size-4" aria-hidden="true" />
                  <h2 className="font-display text-sm font-semibold text-ink">By zone</h2>
                </div>
                <HorizontalBarChart data={zoneBreakdown} />
              </section>
            )}
          </div>
        )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-ink">
              Recent complaints
            </h2>
            <LinkButton to="/citizen/complaints" variant="ghost" size="sm">
              View all
            </LinkButton>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-[4.5rem] w-full" />
              <Skeleton className="h-[4.5rem] w-full" />
              <Skeleton className="h-[4.5rem] w-full" />
            </div>
          ) : recent.length === 0 ? (
            <EmptyState
              icon={FilePlus2}
              title="No complaints yet"
              description="Report your first civic issue — a photo, a pin on the map, and a category is all it takes."
              action={<LinkButton to="/citizen/file">File a complaint</LinkButton>}
              className="rounded-lg border border-line bg-surface"
            />
          ) : (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="show"
              className="space-y-2"
            >
              {recent.map((c) => (
                <motion.div key={c.id} variants={staggerItem}>
                  <ComplaintListItem complaint={c} to={`/citizen/complaints/${c.id}`} />
                </motion.div>
              ))}
            </motion.div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="from-csp/15 relative overflow-hidden rounded-lg border border-line bg-gradient-to-br via-transparent to-transparent p-5">
            <Trophy
              className="text-csp pointer-events-none absolute -top-4 -right-4 size-28 opacity-[0.07]"
              aria-hidden="true"
            />
            <div className="relative flex items-center gap-2">
              <Trophy className="text-csp size-5" aria-hidden="true" />
              <p className="font-display text-base font-semibold text-ink">
                Civic Service Points
              </p>
            </div>
            {pointsLoading ? (
              <Skeleton className="relative mt-3 h-9 w-24" />
            ) : (
              <p className="text-csp relative mt-3 font-mono text-3xl font-semibold">
                <AnimatedNumber value={points?.totalLifetimeCsp ?? 0} />
              </p>
            )}
            {(points?.currentMonthCsp ?? 0) > 0 && (
              <p className="bg-csp/15 text-csp relative mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium">
                +{points?.currentMonthCsp} this month
              </p>
            )}
            <LinkButton
              to="/citizen/gamification"
              variant="outline"
              size="sm"
              className="relative mt-4 w-full"
            >
              View badges &amp; leaderboard
            </LinkButton>
          </div>

          {recentlyViewed.length > 0 && (
            <RecentlyViewedList items={recentlyViewed} onClear={clearRecentlyViewed} />
          )}

          <div className="rounded-lg border border-line bg-surface p-5">
            <div className="flex items-center gap-2">
              <Rss className="text-brand size-5" aria-hidden="true" />
              <p className="font-display text-base font-semibold text-ink">
                Explore the feed
              </p>
            </div>
            <p className="text-ink-muted mt-2 text-sm">
              See what's being reported and fixed in your zone.
            </p>
            <LinkButton
              to="/citizen/feed"
              variant="outline"
              size="sm"
              className="mt-4 w-full"
            >
              Open feed
            </LinkButton>
          </div>
        </aside>
      </div>
    </div>
  );
}
