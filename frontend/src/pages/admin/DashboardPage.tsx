import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
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
import { Label } from "@/components/ui/Label";
import { Combobox } from "@/components/ui/Combobox";
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
import { useAdminAnalytics } from "@/hooks/useAdminAnalytics";
import { useSortableRows } from "@/hooks/useSortableRows";
import { exportRowsToCsv } from "@/lib/csvExport";
import { formatFullDate } from "@/lib/greeting";
import { staggerContainer } from "@/lib/motionVariants";
import { cn } from "@/lib/utils";
import type { SeverityLabel, ZoneMetrics } from "@/types/api";

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

export function AdminDashboardPage() {
  const { data: analytics, isLoading } = useAdminAnalytics();
  const zones = useMemo(() => analytics?.zones ?? [], [analytics]);

  const totalPending = zones.reduce((s, z) => s + (z.pending ?? 0), 0);
  const totalOverdue = zones.reduce((s, z) => s + (z.overdue ?? 0), 0);
  const totalResolved = zones.reduce((s, z) => s + (z.resolvedThisMonth ?? 0), 0);
  const resolutionSamples = zones.filter((z) => z.avgResolutionHours != null);
  const avgResolution =
    resolutionSamples.length > 0
      ? resolutionSamples.reduce((s, z) => s + z.avgResolutionHours!, 0) /
        resolutionSamples.length
      : null;

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

  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const zoneA = zones.find((z) => z.zoneId === compareA);
  const zoneB = zones.find((z) => z.zoneId === compareB);

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
            Live cross-zone overview — every number reflects the current database state.
          </p>
        </div>
        {generatedTime && (
          <span className="text-ink-muted bg-surface-hover mt-1 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium">
            <Radio
              className="text-status-resolved size-3.5 shrink-0"
              aria-hidden="true"
            />
            Live as of {generatedTime}
          </span>
        )}
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

      {!isLoading && zones.length >= 2 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.14 }}
          className="rounded-lg border border-line bg-surface p-5"
        >
          <h2 className="font-display mb-4 text-base font-semibold text-ink">
            Compare two zones
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="compare-zone-a">Zone A</Label>
              <Combobox
                id="compare-zone-a"
                value={compareA}
                onChange={setCompareA}
                placeholder="Select a zone…"
                options={zones.map((z) => ({
                  value: z.zoneId ?? "",
                  label: zoneLabel(z),
                }))}
              />
            </div>
            <div>
              <Label htmlFor="compare-zone-b">Zone B</Label>
              <Combobox
                id="compare-zone-b"
                value={compareB}
                onChange={setCompareB}
                placeholder="Select a zone…"
                options={zones.map((z) => ({
                  value: z.zoneId ?? "",
                  label: zoneLabel(z),
                }))}
              />
            </div>
          </div>
          {zoneA && zoneB && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {[zoneA, zoneB].map((zone, i) => (
                <div key={zone.zoneId ?? i} className="rounded-md border border-line p-4">
                  <p className="font-display text-sm font-semibold text-ink">
                    {zoneLabel(zone)}
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-ink-faint text-xs">Pending</dt>
                      <dd className="font-mono text-ink">{zone.pending ?? 0}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-faint text-xs">Overdue</dt>
                      <dd
                        className={cn(
                          "font-mono",
                          (zone.overdue ?? 0) > 0 ? "text-sla-overdue" : "text-ink",
                        )}
                      >
                        {zone.overdue ?? 0}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-faint text-xs">Resolved (mo.)</dt>
                      <dd className="text-status-resolved font-mono">
                        {zone.resolvedThisMonth ?? 0}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-faint text-xs">Avg. resolution</dt>
                      <dd className="text-ink font-mono">
                        {zone.avgResolutionHours != null
                          ? `${Math.round(zone.avgResolutionHours)}h`
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          )}
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
            export, use the Complaints page instead.
          </p>
          <Table>
            <TableHead>
              <TableRow>
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
              {sortedZones.map((zone) => (
                <TableRow key={zone.zoneId}>
                  <TableCell className="font-medium text-ink">
                    {zoneLabel(zone)}
                  </TableCell>
                  <TableCell>{zone.pending ?? 0}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "flex items-center gap-1.5",
                        zone.isHighestOverdue && "text-sla-overdue font-semibold",
                      )}
                    >
                      {zone.isHighestOverdue && (
                        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                      )}
                      {zone.overdue ?? 0}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-status-resolved flex items-center gap-1.5">
                      <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                      {zone.resolvedThisMonth ?? 0}
                    </span>
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
              ))}
            </TableBody>
          </Table>
        </motion.section>
      )}
    </div>
  );
}
