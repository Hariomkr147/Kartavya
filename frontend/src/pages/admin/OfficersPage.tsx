import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, UserCog } from "lucide-react";
import { Label } from "@/components/ui/Label";
import { Combobox } from "@/components/ui/Combobox";
import { DatePicker } from "@/components/ui/DatePicker";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  SortableHeaderCell,
  TableCell,
} from "@/components/ui/DataTable";
import { StatusTriadChart } from "@/components/charts/StatusTriadChart";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { useZones } from "@/hooks/useZones";
import { useOfficersPerformance } from "@/hooks/useOfficersPerformance";
import { useSortableRows } from "@/hooks/useSortableRows";
import type { OfficerPerformance, User } from "@/types/api";
import { RefreshButton } from "@/components/ui/RefreshButton";

type Period = "this_month" | "last_month" | "all_time" | "custom";

type OfficerSortKey =
  "name" | "zone" | "totalHandled" | "onTimePct" | "acceptPct" | "avgResolutionHours";

interface OfficerRow {
  officer: User;
  zoneName: string;
  perf: OfficerPerformance | undefined;
}

function onTimePct(perf: OfficerPerformance | undefined): number | null {
  if (!perf) return null;
  const total = (perf.onTime ?? 0) + (perf.delayed ?? 0) + (perf.overdue ?? 0);
  return total > 0 ? ((perf.onTime ?? 0) / total) * 100 : null;
}

export function AdminOfficersPage() {
  const [zoneFilter, setZoneFilter] = useState("");
  const [period, setPeriod] = useState<Period>("this_month");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [expandedOfficerId, setExpandedOfficerId] = useState<string | null>(null);

  const { data: zones } = useZones();
  const {
    data: officers,
    isLoading: officersLoading,
    isFetching: officersFetching,
    refetch: refetchOfficers,
  } = useAdminUsers({
    role: "OFFICER",
    zoneId: zoneFilter || undefined,
    pageSize: 100,
  });

  const officerIds = useMemo(() => officers?.data.map((o) => o.id) ?? [], [officers]);
  const perfParams = useMemo(
    () =>
      period === "custom"
        ? {
            dateFrom: dateFrom ? dateFrom.toISOString() : undefined,
            dateTo: dateTo ? dateTo.toISOString() : undefined,
          }
        : { period },
    [period, dateFrom, dateTo],
  );
  const { data: perfByOfficerId, isLoading: perfLoading } = useOfficersPerformance(
    officerIds,
    perfParams,
  );

  const rows = useMemo<OfficerRow[]>(
    () =>
      (officers?.data ?? []).map((officer) => ({
        officer,
        zoneName: zones?.find((z) => z.id === officer.zoneId)?.name ?? "—",
        perf: perfByOfficerId?.get(officer.id),
      })),
    [officers, zones, perfByOfficerId],
  );

  const { sorted, sort, toggleSort } = useSortableRows<OfficerRow, OfficerSortKey>(rows, {
    name: (r) => r.officer.name,
    zone: (r) => r.zoneName,
    totalHandled: (r) => r.perf?.totalHandled ?? null,
    onTimePct: (r) => onTimePct(r.perf),
    acceptPct: (r) =>
      r.perf?.acceptRejectRatio != null ? r.perf.acceptRejectRatio * 100 : null,
    avgResolutionHours: (r) => r.perf?.avgResolutionHours ?? null,
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="font-display text-display-sm font-semibold text-ink">
            Officers
          </h1>
          <RefreshButton
            onRefresh={refetchOfficers}
            refreshing={officersFetching}
            what="officers"
          />
        </div>
        <p className="text-ink-muted mt-1 text-sm">
          Performance scorecards across the whole officer roster.
        </p>
      </div>

      <div className="flex flex-wrap gap-4 rounded-lg border border-line bg-surface p-4">
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="officers-zone">Zone</Label>
          <Combobox
            id="officers-zone"
            value={zoneFilter}
            onChange={setZoneFilter}
            options={[
              { value: "", label: "All zones" },
              ...(zones?.map((z) => ({ value: z.id, label: z.name })) ?? []),
            ]}
          />
        </div>
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="officers-period">Period</Label>
          <Combobox
            id="officers-period"
            value={period}
            onChange={(v) => setPeriod(v as Period)}
            options={[
              { value: "this_month", label: "This month" },
              { value: "last_month", label: "Last month" },
              { value: "all_time", label: "All time" },
              { value: "custom", label: "Custom range…" },
            ]}
          />
        </div>
        {period === "custom" && (
          <>
            <div className="min-w-[9rem] flex-1">
              <Label htmlFor="officers-from">From</Label>
              <DatePicker
                id="officers-from"
                value={dateFrom}
                maxDate={dateTo}
                onChange={setDateFrom}
              />
            </div>
            <div className="min-w-[9rem] flex-1">
              <Label htmlFor="officers-to">To</Label>
              <DatePicker
                id="officers-to"
                value={dateTo}
                minDate={dateFrom}
                onChange={setDateTo}
              />
            </div>
          </>
        )}
      </div>

      {officersLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={UserCog}
          title="No officers match"
          description="Try a different zone filter."
          className="rounded-lg border border-line bg-surface"
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell className="w-8" />
              <SortableHeaderCell
                active={sort.key === "name"}
                direction={sort.direction}
                onSort={() => toggleSort("name")}
              >
                Officer
              </SortableHeaderCell>
              <SortableHeaderCell
                active={sort.key === "zone"}
                direction={sort.direction}
                onSort={() => toggleSort("zone")}
              >
                Zone
              </SortableHeaderCell>
              <SortableHeaderCell
                active={sort.key === "totalHandled"}
                direction={sort.direction}
                onSort={() => toggleSort("totalHandled")}
              >
                Handled
              </SortableHeaderCell>
              <SortableHeaderCell
                active={sort.key === "onTimePct"}
                direction={sort.direction}
                onSort={() => toggleSort("onTimePct")}
              >
                On-time %
              </SortableHeaderCell>
              <SortableHeaderCell
                active={sort.key === "acceptPct"}
                direction={sort.direction}
                onSort={() => toggleSort("acceptPct")}
              >
                Accept rate
              </SortableHeaderCell>
              <SortableHeaderCell
                active={sort.key === "avgResolutionHours"}
                direction={sort.direction}
                onSort={() => toggleSort("avgResolutionHours")}
              >
                Avg. resolution
              </SortableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((row) => {
              const expanded = expandedOfficerId === row.officer.id;
              const pct = onTimePct(row.perf);
              const acceptPct =
                row.perf?.acceptRejectRatio != null
                  ? Math.round(row.perf.acceptRejectRatio * 100)
                  : null;
              return (
                <Fragment key={row.officer.id}>
                  <TableRow>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedOfficerId(expanded ? null : row.officer.id)
                        }
                        aria-expanded={expanded}
                        aria-label={expanded ? "Collapse scorecard" : "Expand scorecard"}
                        className="text-ink-muted hover:text-ink flex size-6 items-center justify-center rounded"
                      >
                        {expanded ? (
                          <ChevronDown className="size-4" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="size-4" aria-hidden="true" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="font-medium text-ink">
                      {row.officer.name}
                      <span className="text-ink-faint block text-xs font-normal">
                        {row.officer.email}
                      </span>
                    </TableCell>
                    <TableCell className="text-ink-muted text-sm">
                      {row.zoneName}
                    </TableCell>
                    <TableCell>
                      {perfLoading ? (
                        <Skeleton className="h-4 w-8" />
                      ) : (
                        (row.perf?.totalHandled ?? "—")
                      )}
                    </TableCell>
                    <TableCell>
                      {perfLoading ? (
                        <Skeleton className="h-4 w-10" />
                      ) : pct != null ? (
                        `${Math.round(pct)}%`
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {perfLoading ? (
                        <Skeleton className="h-4 w-10" />
                      ) : acceptPct != null ? (
                        `${acceptPct}%`
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-ink-muted">
                      {perfLoading ? (
                        <Skeleton className="h-4 w-10" />
                      ) : row.perf?.avgResolutionHours != null ? (
                        `${Math.round(row.perf.avgResolutionHours)}h`
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                  {expanded && row.perf && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-canvas p-4">
                        <OfficerScorecard perf={row.perf} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function OfficerScorecard({ perf }: { perf: OfficerPerformance }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <p className="text-ink-muted mb-3 text-sm font-medium">On-time delivery</p>
        <StatusTriadChart
          segments={[
            { label: "On time", value: perf.onTime ?? 0, tone: "good" },
            { label: "Delayed", value: perf.delayed ?? 0, tone: "neutral" },
            { label: "Overdue", value: perf.overdue ?? 0, tone: "bad" },
          ]}
        />
        <p className="text-ink-faint mt-3 text-xs">
          {perf.unresolvableExcluded ?? 0} complaint
          {(perf.unresolvableExcluded ?? 0) === 1 ? "" : "s"} marked Unresolvable are
          excluded from the figures above.
        </p>
      </div>
      <div>
        <p className="text-ink-muted mb-3 text-sm font-medium">Evidence review</p>
        <StatusTriadChart
          segments={[
            { label: "Valid", value: perf.evidenceBreakdown?.valid ?? 0, tone: "good" },
            {
              label: "Needed more",
              value: perf.evidenceBreakdown?.needsMoreEvidence ?? 0,
              tone: "neutral",
            },
            {
              label: "Rejected",
              value: perf.evidenceBreakdown?.rejected ?? 0,
              tone: "bad",
            },
          ]}
        />
      </div>
    </div>
  );
}
