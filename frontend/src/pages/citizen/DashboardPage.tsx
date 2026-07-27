import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Camera,
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
import { ConfirmFixButton } from "@/components/complaint/ConfirmFixButton";
import { StatCard } from "@/components/dashboard/StatCard";
import { AnimatedNumber } from "@/components/dashboard/AnimatedNumber";
import { RecentlyViewedList } from "@/components/dashboard/RecentlyViewedList";
import { UpdatesCard } from "@/components/dashboard/UpdatesCard";
import {
  HorizontalBarChart,
  type BarDatum,
} from "@/components/charts/HorizontalBarChart";
import { useAuth } from "@/contexts/AuthContext";
import { useMyComplaints } from "@/hooks/useMyComplaints";
import { usePointsSummary } from "@/hooks/usePointsSummary";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { useComplaintUpdates } from "@/hooks/useComplaintUpdates";
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

// Below this, a bar chart of your own six reports says less than the list
// right above it does — the breakdowns only earn their space once there's a
// real distribution to see.
const CHART_MIN_COMPLAINTS = 8;

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
  const { updates, acknowledge } = useComplaintUpdates();

  const complaints = useMemo(() => data?.data ?? [], [data]);
  const actionNeeded = complaints.filter((c) => c.citizenActionNeeded);
  const toConfirm = actionNeeded.filter((c) => c.citizenActionNeeded === "CONFIRM_FIX");
  const needEvidence = actionNeeded.filter(
    (c) => c.citizenActionNeeded === "PROVIDE_MORE_EVIDENCE",
  );
  const recent = complaints.slice(0, 5);
  const active = complaints.filter((c) => ACTIVE_STATUSES.has(c.status));
  const resolvedCount = complaints.filter((c) => RESOLVED_STATUSES.has(c.status)).length;
  // The SLA labels are derived server-side from the complaint's own targets —
  // this only counts them, it never recomputes one.
  const runningLateCount = active.filter(
    (c) => c.slaLabel === "DELAYED" || c.slaLabel === "OVERDUE",
  ).length;

  const categoryBreakdown = useMemo(
    () => topBreakdown(complaints, (c) => c.category.name),
    [complaints],
  );
  const zoneBreakdown = useMemo(
    () => topBreakdown(complaints, (c) => c.zoneName),
    [complaints],
  );
  const showCharts =
    !isLoading &&
    complaints.length >= CHART_MIN_COMPLAINTS &&
    (categoryBreakdown.length > 0 || zoneBreakdown.length > 0);

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

      <UpdatesCard updates={updates} onDismiss={acknowledge} />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
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
            aria-label={`View ${active.length} active complaints`}
          >
            <StatCard
              icon={ClipboardList}
              label="Active complaints"
              value={active.length}
              hint={runningLateCount > 0 ? `${runningLateCount} running late` : undefined}
              hintTone="warning"
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
          <Link
            to="/citizen/complaints?action=1"
            className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            aria-label={`View ${actionNeeded.length} complaints needing your attention`}
          >
            <StatCard
              icon={CircleAlert}
              label="Needs your attention"
              value={actionNeeded.length}
              accent={actionNeeded.length > 0 ? "warning" : "brand"}
              hint={
                actionNeeded.length > 0
                  ? [
                      toConfirm.length > 0 && `${toConfirm.length} to confirm`,
                      needEvidence.length > 0 && `${needEvidence.length} needs a photo`,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : undefined
              }
            />
          </Link>
          <Link
            to="/citizen/gamification"
            className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            aria-label="View your Civic Service Points, badges and leaderboard"
          >
            <StatCard
              icon={Trophy}
              label="Civic Service Points"
              value={points?.totalLifetimeCsp ?? 0}
              accent="csp"
              hint={
                (points?.currentMonthCsp ?? 0) > 0
                  ? `+${points?.currentMonthCsp} this month`
                  : undefined
              }
            />
          </Link>
        </motion.div>
      )}

      {toConfirm.length > 0 && (
        <ActionSection
          tone="good"
          icon={CheckCircle2}
          title={
            toConfirm.length === 1
              ? "1 fix is waiting on your word"
              : `${toConfirm.length} fixes are waiting on your word`
          }
          description="An officer says these are done. Confirm to close them and collect your points — or open one to dispute it."
          complaints={toConfirm}
          renderAction={(complaint) => <ConfirmFixButton complaintId={complaint.id} />}
        />
      )}

      {needEvidence.length > 0 && (
        <ActionSection
          tone="warning"
          icon={Camera}
          title={
            needEvidence.length === 1
              ? "1 report needs a clearer photo"
              : `${needEvidence.length} reports need a clearer photo`
          }
          description="The resolution clock is paused on these until you send a better picture."
          complaints={needEvidence}
        />
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

      {showCharts && (
        <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
          {categoryBreakdown.length > 0 && (
            <section className="rounded-lg border border-line bg-surface p-5">
              <div className="mb-3 flex items-center gap-2">
                <Tag className="text-ink-muted size-4" aria-hidden="true" />
                <h2 className="font-display text-sm font-semibold text-ink">
                  What you report most
                </h2>
              </div>
              <HorizontalBarChart data={categoryBreakdown} />
            </section>
          )}
          {zoneBreakdown.length > 0 && (
            <section className="rounded-lg border border-line bg-surface p-5">
              <div className="mb-3 flex items-center gap-2">
                <MapPinned className="text-ink-muted size-4" aria-hidden="true" />
                <h2 className="font-display text-sm font-semibold text-ink">
                  Where you report
                </h2>
              </div>
              <HorizontalBarChart data={zoneBreakdown} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

const SECTION_TONES = {
  good: {
    card: "border-status-resolved/30 bg-status-resolved-subtle",
    icon: "text-status-resolved",
  },
  warning: {
    card: "border-status-needs_more_evidence/30 bg-status-needs_more_evidence-subtle",
    icon: "text-status-needs_more_evidence",
  },
} as const;

/**
 * One block per kind of `citizenActionNeeded`. Splitting them is what lets
 * each carry the right verb — "confirm" and "add a photo" are different jobs
 * and only one of them can be done in place.
 */
function ActionSection({
  tone,
  icon: Icon,
  title,
  description,
  complaints,
  renderAction,
}: {
  tone: keyof typeof SECTION_TONES;
  icon: typeof CheckCircle2;
  title: string;
  description: string;
  complaints: Complaint[];
  renderAction?: (complaint: Complaint) => ReactNode;
}) {
  const classes = SECTION_TONES[tone];
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`rounded-lg border p-4 ${classes.card}`}
    >
      <div className="mb-1 flex items-center gap-2">
        <Icon className={`size-5 shrink-0 ${classes.icon}`} aria-hidden="true" />
        <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
      </div>
      <p className="text-ink-muted mb-3 text-sm">{description}</p>
      <div className="space-y-2">
        {complaints.map((complaint) => (
          <ComplaintListItem
            key={complaint.id}
            complaint={complaint}
            to={`/citizen/complaints/${complaint.id}`}
            action={renderAction?.(complaint)}
          />
        ))}
      </div>
    </motion.section>
  );
}
