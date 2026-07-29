import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUp, ClipboardList, Search, X } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Combobox } from "@/components/ui/Combobox";
import { Label } from "@/components/ui/Label";
import { Checkbox } from "@/components/ui/Checkbox";
import { Button } from "@/components/ui/Button";
import { PhotoThumb } from "@/components/ui/PhotoThumb";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { StatusPill, SeverityPill, SlaPill } from "@/components/ui/pills";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  SortableHeaderCell,
  TableCell,
  DataTableEmpty,
} from "@/components/ui/DataTable";
import { DynamicIcon } from "@/components/DynamicIcon";
import { BatchStatusModal } from "@/components/complaint/BatchStatusModal";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/contexts/AuthContext";
import { useOfficerQueue } from "@/hooks/useOfficerQueue";
import { useClaimComplaint } from "@/hooks/useClaimComplaint";
import { useCategories } from "@/hooks/useCategories";
import { useSearchParamState } from "@/hooks/useSearchParamState";
import { useSortableRows, type ComparatorsByKey } from "@/hooks/useSortableRows";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { ApiRequestError } from "@/services/http";
import type { GetOfficerQueueParams } from "@/services/officer";
import type { Complaint, ComplaintStatus, SeverityLabel, SlaLabel } from "@/types/api";

const ACTIVE_STATUSES: ComplaintStatus[] = [
  "SUBMITTED",
  "EVIDENCE_UNDER_REVIEW",
  "NEEDS_MORE_EVIDENCE",
  "UNDER_REVIEW",
  "IN_PROGRESS",
  "UNDER_RESOLUTION",
  "RESOLVED",
  "REOPENED",
];

type QueueTab = "active" | "overdue" | "unassigned" | "mine";

const TAB_LABELS: Record<QueueTab, string> = {
  active: "All Active",
  overdue: "Overdue",
  unassigned: "Unassigned",
  mine: "My Queue",
};

function isQueueTab(value: string): value is QueueTab {
  return value in TAB_LABELS;
}

const SEVERITY_VALUES: SeverityLabel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const SEVERITY_RANK: Record<SeverityLabel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};
const SLA_RANK: Record<SlaLabel, number> = { ON_TIME: 0, DELAYED: 1, OVERDUE: 2 };
const STATUS_RANK: Record<ComplaintStatus, number> = {
  SUBMITTED: 0,
  EVIDENCE_UNDER_REVIEW: 1,
  NEEDS_MORE_EVIDENCE: 2,
  UNDER_REVIEW: 3,
  IN_PROGRESS: 4,
  UNDER_RESOLUTION: 5,
  RESOLVED: 6,
  REOPENED: 7,
  CLOSED: 8,
  REJECTED: 9,
  UNRESOLVABLE: 10,
};

type QueueSortKey =
  | "category"
  | "status"
  | "severity"
  | "sla"
  | "upvotes"
  | "createdAt";

// Mirrors the field names the mock's `sort` query param recognizes
// (createdAt/updatedAt/severity/sla/upvotes, see mocks/lib/sort.ts) even
// though this sort runs entirely client-side over the rows already loaded
// below — see the FETCH_SIZE note.
const QUEUE_COMPARATORS: ComparatorsByKey<Complaint, QueueSortKey> = {
  category: (row) => row.category.name,
  status: (row) => STATUS_RANK[row.status],
  severity: (row) => (row.severityLabel ? SEVERITY_RANK[row.severityLabel] : -1),
  sla: (row) => (row.slaLabel ? SLA_RANK[row.slaLabel] : -1),
  upvotes: (row) => row.upvoteCount ?? 0,
  createdAt: (row) => new Date(row.createdAt).getTime(),
};

const PAGE_SIZE = 10;
// The API has no free-text search or "assigned to me" filter, so those two
// narrowings happen client-side over a generously-sized fetch, then get
// paginated locally — see the `rows`/`paged` derivation below. Column
// sorting (useSortableRows, below) is likewise scoped to this loaded set of
// at most FETCH_SIZE rows, not the officer's entire queue.
const FETCH_SIZE = 100;

export function OfficerQueuePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useSearchParamState<QueueTab>("tab", "active", {
    serialize: (v) => (v === "active" ? undefined : v),
    deserialize: (raw) => (isQueueTab(raw) ? raw : "active"),
  });
  const [categoryId, setCategoryId] = useSearchParamState("category", "");
  const [severity, setSeverity] = useSearchParamState<SeverityLabel | "">(
    "severity",
    "",
    {
      serialize: (v) => (v ? v : undefined),
      deserialize: (raw) =>
        SEVERITY_VALUES.includes(raw as SeverityLabel) ? (raw as SeverityLabel) : "",
    },
  );
  const [search, setSearch] = useSearchParamState("q", "");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  // Which row's claim is in flight. `claim.isPending` is shared by every row,
  // so keying the spinner off it alone would spin all the Claim buttons at
  // once when only one complaint is actually being claimed.
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [, setRawSearchParams] = useSearchParams();

  const { data: categories } = useCategories();
  const claim = useClaimComplaint();

  const queryParams = useMemo<GetOfficerQueueParams>(() => {
    const params: GetOfficerQueueParams = { pageSize: FETCH_SIZE, page: 1 };
    if (tab === "unassigned") params.status = ["SUBMITTED"];
    else if (tab === "active" || tab === "mine") params.status = ACTIVE_STATUSES;
    if (tab === "overdue") params.slaLabel = "OVERDUE";
    if (categoryId) params.categoryId = categoryId;
    if (severity) params.severityLabel = severity;
    return params;
  }, [tab, categoryId, severity]);

  const { data, isLoading } = useOfficerQueue(queryParams);

  const rows = useMemo(() => {
    let items = data?.data ?? [];
    if (tab === "mine" && user) {
      items = items.filter((c) => c.assignedOfficerId === user.id);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter(
        (c) =>
          c.id.toLowerCase().includes(q) || c.category.name.toLowerCase().includes(q),
      );
    }
    return items;
  }, [data, tab, user, search]);

  const { sorted, sort, toggleSort } = useSortableRows(rows, QUEUE_COMPARATORS);

  const total = sorted.length;
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // REOPENED has no legal officer-triggered transition — it's the one exit
  // that belongs to the admin's dispute review — so it can never be a valid
  // batch target and must not be selectable for one.
  const selectablePageIds = paged.filter((c) => c.status !== "REOPENED").map((c) => c.id);
  const allSelectedOnPage =
    selectablePageIds.length > 0 && selectablePageIds.every((id) => selected.has(id));
  const someSelectedOnPage =
    !allSelectedOnPage && selectablePageIds.some((id) => selected.has(id));

  function sortableProps(key: QueueSortKey) {
    return {
      active: sort.key === key,
      direction: sort.key === key ? sort.direction : ("asc" as const),
      onSort: () => toggleSort(key),
    };
  }

  function resetForFilterChange() {
    setPage(1);
    setSelected(new Set());
  }

  // Deliberately leaves `tab` alone — that's the primary view mode, with its
  // own visible control, not one of the narrowing filters. Cleared in one
  // functional update rather than three setter calls: each per-field setter
  // closes over its own snapshot of the URL, so sequential calls would
  // overwrite each other and only the last field would actually clear.
  const hasFilters = categoryId !== "" || severity !== "" || search.trim() !== "";

  function clearFilters() {
    setRawSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of ["category", "severity", "q"]) next.delete(key);
        return next;
      },
      { replace: true },
    );
    resetForFilterChange();
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelectedOnPage) selectablePageIds.forEach((id) => next.delete(id));
      else selectablePageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleClaim(complaintId: string) {
    setClaimingId(complaintId);
    try {
      await claim.mutateAsync(complaintId);
      toast({
        title: "Complaint claimed",
        description: "It's now in your evidence-review queue.",
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Couldn't claim this complaint",
        description: error instanceof ApiRequestError ? error.message : undefined,
        variant: "error",
      });
    } finally {
      setClaimingId(null);
    }
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-display-sm font-semibold text-ink">
          Complaint Queue
        </h1>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as QueueTab);
          resetForFilterChange();
        }}
      >
        <TabsList>
          {(Object.keys(TAB_LABELS) as QueueTab[]).map((key) => (
            <TabsTrigger key={key} value={key}>
              {TAB_LABELS[key]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap gap-4 rounded-lg border border-line bg-surface p-4">
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="queue-search">Search</Label>
          <Input
            id="queue-search"
            leftIcon={<Search className="size-4" aria-hidden="true" />}
            placeholder="Complaint ID or category…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetForFilterChange();
            }}
          />
        </div>
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="queue-category">Category</Label>
          <Combobox
            id="queue-category"
            value={categoryId}
            onChange={(value) => {
              setCategoryId(value);
              resetForFilterChange();
            }}
            options={[
              { value: "", label: "All categories" },
              ...(categories?.map((c) => ({ value: c.id, label: c.name })) ?? []),
            ]}
          />
        </div>
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="queue-severity">Severity</Label>
          <Combobox
            id="queue-severity"
            value={severity}
            onChange={(value) => {
              setSeverity(value as SeverityLabel | "");
              resetForFilterChange();
            }}
            options={[
              { value: "", label: "All severities" },
              { value: "LOW", label: "Low" },
              { value: "MEDIUM", label: "Medium" },
              { value: "HIGH", label: "High" },
              { value: "CRITICAL", label: "Critical" },
            ]}
          />
        </div>
        {hasFilters && (
          <div className="flex items-end">
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="size-3.5" aria-hidden="true" />
              Clear filters
            </Button>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="bg-brand/10 border-brand/30 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
          <p className="text-sm font-medium text-ink">{selected.size} selected</p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              <X className="size-4" aria-hidden="true" />
              Clear
            </Button>
            <Button size="sm" onClick={() => setBatchOpen(true)}>
              Batch update status…
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No complaints match"
          description="Try a different tab or filter."
          className="rounded-lg border border-line bg-surface"
        />
      ) : (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell className="w-10">
                  <Checkbox
                    aria-label="Select all on this page"
                    checked={allSelectedOnPage}
                    indeterminate={someSelectedOnPage}
                    onChange={toggleSelectAll}
                    disabled={selectablePageIds.length === 0}
                  />
                </TableHeaderCell>
                <TableHeaderCell className="w-14">Photo</TableHeaderCell>
                <SortableHeaderCell {...sortableProps("category")}>
                  Category
                </SortableHeaderCell>
                <SortableHeaderCell {...sortableProps("status")}>
                  Status
                </SortableHeaderCell>
                <SortableHeaderCell {...sortableProps("severity")}>
                  Severity
                </SortableHeaderCell>
                <SortableHeaderCell {...sortableProps("sla")}>SLA</SortableHeaderCell>
                <SortableHeaderCell {...sortableProps("upvotes")}>
                  Upvotes
                </SortableHeaderCell>
                <TableHeaderCell>Assigned</TableHeaderCell>
                <SortableHeaderCell {...sortableProps("createdAt")}>
                  Filed
                </SortableHeaderCell>
                <TableHeaderCell className="text-right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paged.length === 0 ? (
                <DataTableEmpty colSpan={10}>
                  <p className="text-ink-muted text-sm">No complaints on this page.</p>
                </DataTableEmpty>
              ) : (
                paged.map((c) => (
                  <TableRow
                    key={c.id}
                    className={cn(
                      c.severityLabel === "CRITICAL"
                        ? "bg-severity-critical-subtle"
                        : c.slaLabel === "OVERDUE" && "bg-sla-overdue-subtle",
                    )}
                  >
                    <TableCell>
                      <Checkbox
                        aria-label={`Select ${c.id}`}
                        checked={selected.has(c.id)}
                        onChange={() => toggleRow(c.id)}
                        disabled={c.status === "REOPENED"}
                        title={
                          c.status === "REOPENED"
                            ? "Reopened complaints are under admin dispute review and can't be batch-updated by an officer."
                            : undefined
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/officer/queue/${c.id}`}
                        className="bg-surface-hover flex size-10 items-center justify-center overflow-hidden rounded-md"
                        aria-label={`Open ${c.id}`}
                      >
                        <PhotoThumb
                          src={c.photoUrl}
                          className="size-full object-cover"
                          iconClassName="text-ink-faint size-4"
                        />
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/officer/queue/${c.id}`}
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
                    <TableCell>
                      <StatusPill status={c.status} />
                    </TableCell>
                    <TableCell>
                      {c.severityLabel && <SeverityPill severity={c.severityLabel} />}
                    </TableCell>
                    <TableCell>{c.slaLabel && <SlaPill sla={c.slaLabel} />}</TableCell>
                    <TableCell className="text-ink-muted text-sm">
                      <span className="inline-flex items-center gap-1">
                        <ArrowUp className="size-3.5 shrink-0" aria-hidden="true" />
                        {c.upvoteCount ?? 0}
                      </span>
                    </TableCell>
                    <TableCell className="text-ink-muted text-sm">
                      {c.assignedOfficerId == null
                        ? "Unassigned"
                        : c.assignedOfficerId === user?.id
                          ? "You"
                          : `Officer #${c.assignedOfficerId}`}
                    </TableCell>
                    <TableCell className="text-ink-muted text-sm">
                      {relativeTime(c.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.status === "SUBMITTED" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={claimingId === c.id}
                          disabled={claimingId !== null && claimingId !== c.id}
                          onClick={() => handleClaim(c.id)}
                        >
                          Claim
                        </Button>
                      ) : (
                        <Link
                          to={`/officer/queue/${c.id}`}
                          className="text-brand text-sm font-medium hover:underline"
                        >
                          View
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
          />
        </>
      )}

      <BatchStatusModal
        open={batchOpen}
        onClose={() => {
          setBatchOpen(false);
          setSelected(new Set());
        }}
        target={{ type: "ids", complaintIds: [...selected] }}
        statuses={rows.filter((c) => selected.has(c.id)).map((c) => c.status)}
      />
    </div>
  );
}
