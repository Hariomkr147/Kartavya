import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, Download } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { StatusPill, SeverityPill, SlaPill } from "@/components/ui/pills";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  DataTableEmpty,
} from "@/components/ui/DataTable";
import { DynamicIcon } from "@/components/DynamicIcon";
import { useAdminComplaints } from "@/hooks/useAdminComplaints";
import { useCategories } from "@/hooks/useCategories";
import { useZones } from "@/hooks/useZones";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime } from "@/lib/datetime";
import { exportComplaintsCsv, type GetAdminComplaintsParams } from "@/services/admin";
import { ApiRequestError } from "@/services/http";
import type { ComplaintStatus, SlaLabel } from "@/types/api";

const ALL_STATUSES: ComplaintStatus[] = [
  "SUBMITTED",
  "EVIDENCE_UNDER_REVIEW",
  "NEEDS_MORE_EVIDENCE",
  "REJECTED",
  "UNDER_REVIEW",
  "IN_PROGRESS",
  "UNDER_RESOLUTION",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "UNRESOLVABLE",
];

function humanizeStatus(status: ComplaintStatus): string {
  return status
    .toLowerCase()
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

const PAGE_SIZE = 15;

export function AdminComplaintsPage() {
  const { toast } = useToast();
  const [zoneId, setZoneId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [statuses, setStatuses] = useState<Set<ComplaintStatus>>(new Set());
  const [slaLabel, setSlaLabel] = useState<SlaLabel | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const { data: zones } = useZones();
  const { data: categories } = useCategories();

  const filters = useMemo<Omit<GetAdminComplaintsParams, "page" | "pageSize">>(
    () => ({
      zoneId: zoneId || undefined,
      categoryId: categoryId || undefined,
      status: statuses.size > 0 ? [...statuses] : undefined,
      slaLabel: slaLabel || undefined,
      dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
      dateTo: dateTo ? new Date(dateTo).toISOString() : undefined,
      sort: "-createdAt",
    }),
    [zoneId, categoryId, statuses, slaLabel, dateFrom, dateTo],
  );

  const { data, isLoading } = useAdminComplaints({ ...filters, page, pageSize: PAGE_SIZE });
  const rows = data?.data ?? [];

  function resetPage() {
    setPage(1);
  }

  function toggleStatus(status: ComplaintStatus) {
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
    resetPage();
  }

  async function handleExport() {
    setExporting(true);
    try {
      const csv = await exportComplaintsCsv(filters);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "complaints.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof ApiRequestError ? error.message : undefined,
        variant: "error",
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-display-sm font-semibold text-ink">
            Complaints
          </h1>
          <p className="text-ink-muted mt-1 text-sm">
            Every complaint across every zone, with full filtering.
          </p>
        </div>
        <Button variant="outline" size="sm" loading={exporting} onClick={handleExport}>
          <Download className="size-4" aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      <div className="space-y-4 rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap gap-4">
          <div className="min-w-[10rem] flex-1">
            <Label htmlFor="zone-filter">Zone</Label>
            <Select
              id="zone-filter"
              value={zoneId}
              onChange={(e) => {
                setZoneId(e.target.value);
                resetPage();
              }}
            >
              <option value="">All zones</option>
              {zones?.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-[10rem] flex-1">
            <Label htmlFor="category-filter">Category</Label>
            <Select
              id="category-filter"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                resetPage();
              }}
            >
              <option value="">All categories</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-[10rem] flex-1">
            <Label htmlFor="sla-filter">SLA</Label>
            <Select
              id="sla-filter"
              value={slaLabel}
              onChange={(e) => {
                setSlaLabel(e.target.value as SlaLabel | "");
                resetPage();
              }}
            >
              <option value="">All</option>
              <option value="ON_TIME">On time</option>
              <option value="DELAYED">Delayed</option>
              <option value="OVERDUE">Overdue</option>
            </Select>
          </div>
          <div className="min-w-[9rem] flex-1">
            <Label htmlFor="date-from">From</Label>
            <Input
              id="date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                resetPage();
              }}
            />
          </div>
          <div className="min-w-[9rem] flex-1">
            <Label htmlFor="date-to">To</Label>
            <Input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                resetPage();
              }}
            />
          </div>
        </div>

        <div>
          <Label>Status</Label>
          <div className="flex flex-wrap gap-1.5">
            {ALL_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => toggleStatus(status)}
                className={
                  statuses.has(status)
                    ? "bg-brand text-brand-fg rounded-full px-2.5 py-1 text-xs font-medium"
                    : "bg-surface-hover text-ink-muted hover:text-ink rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
                }
              >
                {humanizeStatus(status)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No complaints match"
          description="Try loosening a filter."
          className="rounded-lg border border-line bg-surface"
        />
      ) : (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Category</TableHeaderCell>
                <TableHeaderCell>Zone</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Severity</TableHeaderCell>
                <TableHeaderCell>SLA</TableHeaderCell>
                <TableHeaderCell>Officer</TableHeaderCell>
                <TableHeaderCell>Filed</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <DataTableEmpty colSpan={7}>—</DataTableEmpty>
              ) : (
                rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        to={`/admin/complaints/${c.id}`}
                        className="flex items-center gap-2 hover:underline"
                      >
                        <DynamicIcon
                          icon={iconForCategory(c.category.name)}
                          className="text-ink-faint size-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="font-medium text-ink">{c.category.name}</span>
                        <span className="text-ink-faint font-mono text-xs">{c.id}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-ink-muted text-sm">{c.zoneName}</TableCell>
                    <TableCell>
                      <StatusPill status={c.status} />
                    </TableCell>
                    <TableCell>
                      {c.severityLabel && <SeverityPill severity={c.severityLabel} />}
                    </TableCell>
                    <TableCell>{c.slaLabel && <SlaPill sla={c.slaLabel} />}</TableCell>
                    <TableCell className="text-ink-muted text-sm">
                      {c.assignedOfficerId == null ? "Unassigned" : `Officer #${c.assignedOfficerId}`}
                    </TableCell>
                    <TableCell className="text-ink-muted text-sm">
                      {relativeTime(c.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {data && (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={data.pagination.totalItems}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}
