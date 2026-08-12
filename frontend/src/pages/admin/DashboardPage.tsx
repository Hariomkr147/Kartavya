import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  MapPinned,
  Radio,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  SortableHeaderCell,
  TableCell,
} from "@/components/ui/DataTable";
import { StatCard } from "@/components/dashboard/StatCard";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { ZoneSummaryPanel } from "@/components/admin/ZoneSummaryPanel";
import { useAdminAnalytics } from "@/hooks/useAdminAnalytics";
import { useComplaintVolumeTrend } from "@/hooks/useComplaintVolumeTrend";
import { useZones } from "@/hooks/useZones";
import { useSortableRows } from "@/hooks/useSortableRows";
import { exportRowsToCsv } from "@/lib/csvExport";
import { formatFullDate } from "@/lib/greeting";
import { staggerContainer } from "@/lib/motionVariants";
import { cn } from "@/lib/utils";
import type { SeverityLabel, ZoneMetrics } from "@/types/api";
import { RefreshButton } from "@/components/ui/RefreshButton";

const SEVERITY_ORDER: SeverityLabel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const SEVERITY_VAR: Record<SeverityLabel, string> = {
  LOW: "--color-severity-low",
  MEDIUM: "--color-severity-medium",
  HIGH: "--color-severity-high",
  CRITICAL: "--color-severity-critical",
};

type ZoneSortKey =
  "zoneName" | "pending" | "overdue" | "resolvedThisMonth" | "avgResolutionHours";

function zoneLabel(zone: ZoneMetrics): string {
  return zone.zoneName ?? zone.zoneId ?? "Unknown zone";
}

function citizenLabel(citizen: { displayName?: string; citizenId: string }): string {
  return citizen.displayName ?? `Citizen #${citizen.citizenId}`;
}

/** Weighted by each zone's own resolved-this-month count, not a plain mean
 * of per-zone averages — otherwise a zone that resolved one complaint in
 * 200h would count as much as one that resolved eighty in 10h. */
function weightedAvgResolutionHours(zones: ZoneMetrics[]): number | null {
  let weightedSum = 0;
  let totalResolved = 0;
  for (const z of zones) {
    if (z.avgResolutionHours == null || !z.resolvedThisMonth) continue;
    weightedSum += z.avgResolutionHours * z.resolvedThisMonth;
    totalResolved += z.resolvedThisMonth;
  }
  return totalResolved > 0 ? weightedSum / totalResolved : null;
}

export function AdminDashboardPage() {
  const { data: analytics, isLoading, isFetching, refetch } = useAdminAnalytics();
  const { data: zonesList } = useZones();
  const { data: trend, isLoading: trendLoading } = useComplaintVolumeTrend(14);
  const zones = useMemo(() => analytics?.zones ?? [], [analytics]);
  const [expandedZoneId, setExpandedZoneId] = useState<string | null>(null);

  const totalPending = zones.reduce((s, z) => s + (z.pending ?? 0), 0);
  const totalOverdue = zones.reduce((s, z) => s + (z.overdue ?? 0), 0);
  const totalResolved = zones.reduce((s, z) => s + (z.resolvedThisMonth ?? 0), 0);
  const avgResolution = weightedAvgResolutionHours(zones);

  const catchAllZone = zonesList?.find((z) => z.isCatchAll);
  const catchAllMetrics = zones.find((z) => z.zoneId === catchAllZone?.id);

  const chartData = zones.map((z) => ({
    name: zoneLabel(z),
    Pending: z.pending ?? 0,
    Overdue: z.overdue ?? 0,
    "Resolved this month": z.resolvedThisMonth ?? 0,
  }));

  const maxSeverity = Math.max(
    1,
    ...zones.flatMap((z) => SEVERITY_ORDER.map((s) => z.severityHeat?.[s] ?? 0)),
  );

  const {
    sorted: sortedZones,
    sort,
    toggleSort,
  } = useSortableRows<ZoneMetrics, ZoneSortKey>(zones, {
    zoneName: (z) => zoneLabel(z),
    pending: (z) => z.pending ?? 0,
    overdue: (z) => z.overdue ?? 0,
    resolvedThisMonth: (z) => z.resolvedThisMonth ?? 0,
    avgResolutionHours: (z) => z.avgResolutionHours,
  });

  const generatedTime = analytics?.generatedAt
    ? new Date(analytics.generatedAt).toLocaleTimeString("en-GB")
    : null;

  function handleExportTable() {
    exportRowsToCsv("admin-dashboard-zones-on-screen.csv", sortedZones, [
      { header: "Zone", accessor: (z: ZoneMetrics) => zoneLabel(z) },
      { header: "Pending", accessor: (z: ZoneMetrics) => z.pending ?? 0 },
      { header: "Overdue", accessor: (z: ZoneMetrics) => z.overdue ?? 0 },
      {
        header: "Resolved (this month)",
        accessor: (z: ZoneMetrics) => z.resolvedThisMonth ?? 0,
      },
      {
        header: "Avg. resolution (hours)",
        accessor: (z: ZoneMetrics) => z.avgResolutionHours ?? "",
      },
      ...SEVERITY_ORDER.map((severity) => ({
        header: `Severity: ${severity}`,
        accessor: (z: ZoneMetrics) => z.severityHeat?.[severity] ?? 0,
      })),
    ]);
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-ink-faint text-sm font-medium">{formatFullDate()}</p>
          <h1 className="font-display text-display-sm mt-0.5 font-semibold text-ink">
            Admin Dashboard
          </h1>
          <p className="text-ink-muted mt-1 text-sm">
            Live cross-zone overview.
          </p>
        </div>
        <div className="mt-1 flex items-center gap-2">
          {generatedTime && (
            <span className="text-ink-muted bg-surface-hover inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium">
              <Radio
                className="text-status-resolved size-3.5 shrink-0"
                aria-hidden="true"
              />
              Live as of {generatedTime}
            </span>
          )}
          <RefreshButton
            onRefresh={refetch}
            refreshing={isFetching}
            what="this dashboard"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="grid gap-4 sm:grid-cols-5"
        >
          <StatCard icon={MapPinned} label="Zones" value={zones.length} />
          <StatCard icon={Building2} label="Pending complaints" value={totalPending} />
          <StatCard
            icon={AlertTriangle}
            label="Overdue"
            value={totalOverdue}
            accent={totalOverdue > 0 ? "bad" : "brand"}
          />
          <StatCard
            icon={CheckCircle2}
            label="Resolved (mo.)"
            value={totalResolved}
            accent="good"
          />
          <StatCard
            icon={Clock}
            label="Avg. resolution"
            value={avgResolution != null ? `${Math.round(avgResolution)}h` : "—"}
          />
        </motion.div>
      )}

      {catchAllZone && (catchAllMetrics?.pending ?? 0) > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.06 }}
          className="border-sla-overdue/30 bg-sla-overdue-subtle flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-sla-overdue size-5 shrink-0" aria-hidden="true" />
            <p className="text-sm text-ink">
              <span className="font-semibold">{catchAllMetrics?.pending}</span> complaint
              {catchAllMetrics?.pending === 1 ? "" : "s"} sitting in{" "}
              <span className="font-medium">{catchAllZone.name}</span> (the catch-all
              zone) — a real zone was likely a poor match and needs manual assignment.
            </p>
          </div>
          <Link
            to={`/admin/complaints?zone=${catchAllZone.id}`}
            className="text-brand shrink-0 text-sm font-medium hover:underline"
          >
            Review &amp; reassign →
          </Link>
        </motion.section>
      )}

      {!trendLoading && trend && trend.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.08 }}
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2 className="font-display mb-1 text-base font-semibold text-ink">
            Complaint Tracker
          </h2>
          <p className="text-ink-faint mb-4 text-xs">
            Here's an overview of what has happened over the past 14 days.
          </p>
          <TrendLineChart data={trend} height={180} />
        </motion.section>
      )}

      {!isLoading && zones.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2 className="font-display mb-4 text-base font-semibold text-ink">
            Complaint load by zone
          </h2>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-line" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: "var(--color-ink-muted)" }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: "var(--color-ink-muted)" }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-line)",
                    borderRadius: 8,
                    fontSize: 13,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Pending" fill="var(--color-brand)" radius={[4, 4, 0, 0]} />
                <Bar
                  dataKey="Overdue"
                  fill="var(--color-sla-overdue)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="Resolved this month"
                  fill="var(--color-status-resolved)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.section>
      )}

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : zones.length === 0 ? (
        <p className="text-ink-muted text-sm">No zones have been created yet.</p>
      ) : (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.18 }}
          className="space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-base font-semibold text-ink">
              Per-zone detail
            </h2>
            <Button variant="outline" size="sm" onClick={handleExportTable}>
              <Download className="size-4" aria-hidden="true" />
              Export table on screen (CSV)
            </Button>
          </div>
          <p className="text-ink-faint -mt-1 text-xs">
            Exports exactly what&apos;s rendered below. For the full filtered complaint
            export, use the Complaints page instead. Expand a row for total/active/
            resolved complaint and cluster counts.
          </p>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell className="w-8" />
                <SortableHeaderCell
                  active={sort.key === "zoneName"}
                  direction={sort.direction}
                  onSort={() => toggleSort("zoneName")}
                >
                  Zone
                </SortableHeaderCell>
                <SortableHeaderCell
                  active={sort.key === "pending"}
                  direction={sort.direction}
                  onSort={() => toggleSort("pending")}
                >
                  Pending
                </SortableHeaderCell>
                <SortableHeaderCell
                  active={sort.key === "overdue"}
                  direction={sort.direction}
                  onSort={() => toggleSort("overdue")}
                >
                  Overdue
                </SortableHeaderCell>
                <SortableHeaderCell
                  active={sort.key === "resolvedThisMonth"}
                  direction={sort.direction}
                  onSort={() => toggleSort("resolvedThisMonth")}
                >
                  Resolved (mo.)
                </SortableHeaderCell>
                <SortableHeaderCell
                  active={sort.key === "avgResolutionHours"}
                  direction={sort.direction}
                  onSort={() => toggleSort("avgResolutionHours")}
                >
                  Avg. resolution
                </SortableHeaderCell>
                <TableHeaderCell>Severity heat</TableHeaderCell>
                <TableHeaderCell>Top citizens</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedZones.map((zone) => {
                const expanded = zone.zoneId != null && expandedZoneId === zone.zoneId;
                return (
                  <Fragment key={zone.zoneId}>
                    <TableRow>
                      <TableCell>
                        {zone.zoneId && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedZoneId(expanded ? null : (zone.zoneId ?? null))
                            }
                            aria-expanded={expanded}
                            aria-label={expanded ? "Collapse zone detail" : "Expand zone detail"}
                            className="text-ink-muted hover:text-ink flex size-6 items-center justify-center rounded"
                          >
                            {expanded ? (
                              <ChevronDown className="size-4" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="size-4" aria-hidden="true" />
                            )}
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="font-medium text-ink">
                        {zone.zoneId ? (
                          <Link
                            to={`/admin/complaints?zone=${zone.zoneId}`}
                            className="hover:underline"
                          >
                            {zoneLabel(zone)}
                          </Link>
                        ) : (
                          zoneLabel(zone)
                        )}
                      </TableCell>
                      <TableCell>
                        {zone.zoneId ? (
                          <Link
                            to={`/admin/complaints?zone=${zone.zoneId}`}
                            className="hover:underline"
                          >
                            {zone.pending ?? 0}
                          </Link>
                        ) : (
                          (zone.pending ?? 0)
                        )}
                      </TableCell>
                      <TableCell>
                        {zone.zoneId ? (
                          <Link
                            to={`/admin/complaints?zone=${zone.zoneId}&sla=OVERDUE`}
                            className={cn(
                              "flex items-center gap-1.5 hover:underline",
                              zone.isHighestOverdue && "text-sla-overdue font-semibold",
                            )}
                          >
                            {zone.isHighestOverdue && (
                              <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                            )}
                            {zone.overdue ?? 0}
                          </Link>
                        ) : (
                          (zone.overdue ?? 0)
                        )}
                      </TableCell>
                      <TableCell>
                        {zone.zoneId ? (
                          <Link
                            to={`/admin/complaints?zone=${zone.zoneId}&status=RESOLVED,CLOSED`}
                            className="text-status-resolved flex items-center gap-1.5 hover:underline"
                          >
                            <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                            {zone.resolvedThisMonth ?? 0}
                          </Link>
                        ) : (
                          (zone.resolvedThisMonth ?? 0)
                        )}
                      </TableCell>
                      <TableCell className="text-ink-muted">
                        {zone.avgResolutionHours != null
                          ? `${Math.round(zone.avgResolutionHours)}h`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {SEVERITY_ORDER.map((severity) => {
                            const count = zone.severityHeat?.[severity] ?? 0;
                            const opacity =
                              count === 0 ? 0.08 : 0.25 + (count / maxSeverity) * 0.75;
                            return (
                              <span
                                key={severity}
                                title={`${severity}: ${count}`}
                                style={{
                                  backgroundColor: `color-mix(in oklch, var(${SEVERITY_VAR[severity]}) ${Math.round(opacity * 100)}%, transparent)`,
                                }}
                                className="flex size-7 items-center justify-center rounded text-[10px] font-semibold text-ink"
                              >
                                {count > 0 ? count : ""}
                              </span>
                            );
                          })}
                        </div>
                      </TableCell>
                      <TableCell className="text-ink-muted">
                        {zone.topCitizens && zone.topCitizens.length > 0 ? (
                          <ol className="space-y-0.5">
                            {zone.topCitizens.slice(0, 3).map((citizen, i) => (
                              <li
                                key={citizen.citizenId}
                                className="flex items-center gap-1.5"
                              >
                                <span className="text-ink-faint w-3.5 shrink-0 text-right text-xs">
                                  {i + 1}.
                                </span>
                                <span className="truncate">{citizenLabel(citizen)}</span>
                                <span className="text-ink-faint shrink-0 text-xs">
                                  {citizen.points} CSP
                                </span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                    {expanded && zone.zoneId && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-canvas p-4">
                          <ZoneSummaryPanel zoneId={zone.zoneId} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </motion.section>
      )}
    </div>
  );
}
