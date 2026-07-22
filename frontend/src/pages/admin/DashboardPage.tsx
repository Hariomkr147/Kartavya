import { motion } from "framer-motion";
import { AlertTriangle, Building2, CheckCircle2, Clock, MapPinned } from "lucide-react";
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
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/ui/DataTable";
import { StatCard } from "@/components/dashboard/StatCard";
import { useAdminAnalytics } from "@/hooks/useAdminAnalytics";
import { formatFullDate } from "@/lib/greeting";
import { staggerContainer } from "@/lib/motionVariants";
import { cn } from "@/lib/utils";
import type { SeverityLabel } from "@/types/api";

const SEVERITY_ORDER: SeverityLabel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const SEVERITY_VAR: Record<SeverityLabel, string> = {
  LOW: "--color-severity-low",
  MEDIUM: "--color-severity-medium",
  HIGH: "--color-severity-high",
  CRITICAL: "--color-severity-critical",
};

export function AdminDashboardPage() {
  const { data: analytics, isLoading } = useAdminAnalytics();
  const zones = analytics?.zones ?? [];

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
    name: z.zoneName ?? z.zoneId,
    Pending: z.pending ?? 0,
    Overdue: z.overdue ?? 0,
    "Resolved this month": z.resolvedThisMonth ?? 0,
  }));

  const maxSeverity = Math.max(
    1,
    ...zones.flatMap((z) => SEVERITY_ORDER.map((s) => z.severityHeat?.[s] ?? 0)),
  );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div>
        <p className="text-ink-faint text-sm font-medium">{formatFullDate()}</p>
        <h1 className="font-display text-display-sm mt-0.5 font-semibold text-ink">
          Admin Dashboard
        </h1>
        <p className="text-ink-muted mt-1 text-sm">
          Live cross-zone overview — every number reflects the current database state.
        </p>
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
          <h2 className="font-display text-base font-semibold text-ink">
            Per-zone detail
          </h2>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Zone</TableHeaderCell>
                <TableHeaderCell>Pending</TableHeaderCell>
                <TableHeaderCell>Overdue</TableHeaderCell>
                <TableHeaderCell>Resolved (mo.)</TableHeaderCell>
                <TableHeaderCell>Avg. resolution</TableHeaderCell>
                <TableHeaderCell>Severity heat</TableHeaderCell>
                <TableHeaderCell>Top citizen</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {zones.map((zone) => (
                <TableRow key={zone.zoneId}>
                  <TableCell className="font-medium text-ink">
                    {zone.zoneName ?? zone.zoneId}
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
                        const opacity = count === 0 ? 0.08 : 0.25 + (count / maxSeverity) * 0.75;
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
                    {zone.topCitizens && zone.topCitizens.length > 0
                      ? `${zone.topCitizens[0].displayName ?? `Citizen #${zone.topCitizens[0].citizenId}`} (${zone.topCitizens[0].points} CSP)`
                      : "—"}
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
