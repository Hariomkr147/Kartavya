import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, Download, Search } from "lucide-react";
import { DatePicker } from "@/components/ui/DatePicker";
import { Combobox } from "@/components/ui/Combobox";
import { Input } from "@/components/ui/Input";
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
import { useSearchParamState, csvCodec } from "@/hooks/useSearchParamState";
import { exportRowsToCsv } from "@/lib/csvExport";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime } from "@/lib/datetime";
import { exportComplaintsCsv, type GetAdminComplaintsParams } from "@/services/admin";
import { ApiRequestError } from "@/services/http";
import type { Complaint, ComplaintStatus, SlaLabel } from "@/types/api";

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

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "-createdAt", label: "Newest filed first" },
  { value: "createdAt", label: "Oldest filed first" },
  { value: "-updatedAt", label: "Recently updated first" },
  { value: "updatedAt", label: "Least recently updated first" },
  { value: "-severity", label: "Highest severity first" },
  { value: "severity", label: "Lowest severity first" },
  { value: "-sla", label: "Most SLA time used first" },
  { value: "sla", label: "Least SLA time used first" },
  { value: "-upvotes", label: "Most upvoted first" },
  { value: "upvotes", label: "Least upvoted first" },
];

function humanizeStatus(status: ComplaintStatus): string {
  return status
    .toLowerCase()
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function dateSerialize(d: Date | undefined): string | undefined {
  return d ? d.toISOString() : undefined;
}
function dateDeserialize(raw: string): Date | undefined {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const PAGE_SIZE = 15;

export function AdminComplaintsPage() {
  const { toast } = useToast();
  const [zoneId, setZoneId] = useSearchParamState("zone", "");
  const [categoryId, setCategoryId] = useSearchParamState("category", "");
  const [statusList, setStatusList] = useSearchParamState<string[]>(
    "status",
    [],
    csvCodec,
  );
  const [slaLabel, setSlaLabel] = useSearchParamState<SlaLabel | "">("sla", "");
  const [dateFrom, setDateFrom] = useSearchParamState<Date | undefined>(
    "from",
    undefined,
    {
      serialize: dateSerialize,
      deserialize: dateDeserialize,
    },
  );
  const [dateTo, setDateTo] = useSearchParamState<Date | undefined>("to", undefined, {
    serialize: dateSerialize,
    deserialize: dateDeserialize,
  });
  const [sort, setSort] = useSearchParamState("sort", "-createdAt");
  const [search, setSearch] = useSearchParamState("q", "");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const statuses = useMemo(() => new Set(statusList as ComplaintStatus[]), [statusList]);

  const { data: zones } = useZones();
  const { data: categories } = useCategories();

  const filters = useMemo<Omit<GetAdminComplaintsParams, "page" | "pageSize">>(
    () => ({
      zoneId: zoneId || undefined,
      categoryId: categoryId || undefined,
      status: statusList.length > 0 ? (statusList as ComplaintStatus[]) : undefined,
      slaLabel: slaLabel || undefined,
      dateFrom: dateFrom ? dateFrom.toISOString() : undefined,
      dateTo: dateTo ? dateTo.toISOString() : undefined,
      sort,
    }),
    [zoneId, categoryId, statusList, slaLabel, dateFrom, dateTo, sort],
  );

  const { data, isLoading } = useAdminComplaints({
    ...filters,
    page,
    pageSize: PAGE_SIZE,
  });

  const rows = useMemo(() => {
    const fetched = data?.data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return fetched;
    return fetched.filter(
      (c) =>
        c.id.toLowerCase().includes(term) ||
        c.category.name.toLowerCase().includes(term) ||
        (c.zoneName ?? "").toLowerCase().includes(term),
    );
  }, [data, search]);

  function resetPage() {
    setPage(1);
  }

  function toggleStatus(status: ComplaintStatus) {
    const next = new Set(statuses);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    setStatusList([...next]);
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

  function handleExportVisiblePage() {
    exportRowsToCsv("admin-complaints-page.csv", rows, [
      { header: "ID", accessor: (c: Complaint) => c.id },
      { header: "Category", accessor: (c: Complaint) => c.category.name },
      { header: "Zone", accessor: (c: Complaint) => c.zoneName ?? "" },
      { header: "Status", accessor: (c: Complaint) => c.status },
      { header: "Severity", accessor: (c: Complaint) => c.severityLabel ?? "" },
      { header: "SLA", accessor: (c: Complaint) => c.slaLabel ?? "" },
      { header: "Filed at", accessor: (c: Complaint) => c.createdAt },
      { header: "Officer ID", accessor: (c: Complaint) => c.assignedOfficerId ?? "" },
    ]);
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
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleExportVisiblePage}>
            <Download className="size-4" aria-hidden="true" />
            Export page (CSV)
          </Button>
          <Button variant="outline" size="sm" loading={exporting} onClick={handleExport}>
            <Download className="size-4" aria-hidden="true" />
            Export full filtered set (CSV)
          </Button>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap gap-4">
          <div className="min-w-[10rem] flex-1">
            <Label htmlFor="zone-filter">Zone</Label>
            <Combobox
              id="zone-filter"
              value={zoneId}
              onChange={(v) => {
                setZoneId(v);
                resetPage();
              }}
              options={[
                { value: "", label: "All zones" },
                ...(zones?.map((z) => ({ value: z.id, label: z.name })) ?? []),
              ]}
            />
          </div>
          <div className="min-w-[10rem] flex-1">
            <Label htmlFor="category-filter">Category</Label>
            <Combobox
              id="category-filter"
              value={categoryId}
              placeholder="All categories"
              onChange={(next) => {
                setCategoryId(next);
                resetPage();
              }}
              options={[
                { value: "", label: "All categories" },
                ...(categories?.map((c) => ({
                  value: c.id,
                  label: c.name,
                  icon: (
                    <DynamicIcon
                      icon={iconForCategory(c.name)}
                      className="size-4 shrink-0 text-ink-faint"
                      aria-hidden="true"
                    />
                  ),
                })) ?? []),
              ]}
            />
          </div>
          <div className="min-w-[10rem] flex-1">
            <Label htmlFor="sla-filter">SLA</Label>
            <Combobox
              id="sla-filter"
              value={slaLabel}
              onChange={(v) => {
                setSlaLabel(v as SlaLabel | "");
                resetPage();
              }}
              options={[
                { value: "", label: "All" },
                { value: "ON_TIME", label: "On time" },
                { value: "DELAYED", label: "Delayed" },
                { value: "OVERDUE", label: "Overdue" },
              ]}
            />
          </div>
          <div className="min-w-[9rem] flex-1">
            <Label htmlFor="date-from">From</Label>
            <DatePicker
              id="date-from"
              value={dateFrom}
              maxDate={dateTo}
              onChange={(date) => {
                setDateFrom(date);
                resetPage();
              }}
            />
          </div>
          <div className="min-w-[9rem] flex-1">
            <Label htmlFor="date-to">To</Label>
            <DatePicker
              id="date-to"
              value={dateTo}
              minDate={dateFrom}
              onChange={(date) => {
                setDateTo(date);
                resetPage();
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="min-w-[12rem] flex-1">
            <Label htmlFor="sort-order">Sort by</Label>
            <Combobox
              id="sort-order"
              value={sort}
              onChange={(v) => {
                setSort(v);
                resetPage();
              }}
              options={SORT_OPTIONS}
            />
          </div>
          <div className="min-w-[12rem] flex-1">
            <Label htmlFor="complaint-search">Search this page</Label>
            <Input
              id="complaint-search"
              placeholder="ID, category, or zone…"
              value={search}
              leftIcon={<Search className="size-4" aria-hidden="true" />}
              onChange={(e) => setSearch(e.target.value)}
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
          description="Try loosening a filter or clearing the search box."
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
                      {c.assignedOfficerId == null
                        ? "Unassigned"
                        : `Officer #${c.assignedOfficerId}`}
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
