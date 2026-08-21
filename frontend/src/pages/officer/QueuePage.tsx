import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUp, ClipboardList, Hand, Layers, Search, X } from "lucide-react";
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
import type { TranslationKey } from "@/i18n";
import type { Complaint, ComplaintStatus, SeverityLabel, SlaLabel } from "@/types/api";
import { RefreshButton } from "@/components/ui/RefreshButton";

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

const TAB_LABEL_KEYS: Record<QueueTab, TranslationKey> = {
  active: "officerQueue.tabs.active",
  overdue: "sla.OVERDUE",
  unassigned: "officerQueue.tabs.unassigned",
  mine: "officerQueue.tabs.mine",
};

function isQueueTab(value: string): value is QueueTab {
  return value in TAB_LABEL_KEYS;
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

type QueueSortKey = "category" | "status" | "severity" | "sla" | "upvotes" | "createdAt";

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
  const { t } = useTranslation();
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
  // "" = everything, "clustered" = members of any cluster, "standalone" = the
  // rest, or a specific cluster id to isolate one physical issue.
  const [clusterFilter, setClusterFilter] = useSearchParamState("cluster", "");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  // Which row's claim is in flight. `claim.isPending` is shared by every row,
  // so keying the spinner off it alone would spin all the Claim buttons at
  // once when only one complaint is actually being claimed.
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [batchClaiming, setBatchClaiming] = useState(false);
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

  const { data, isLoading, isFetching, refetch } = useOfficerQueue(queryParams);

  const rows = useMemo(() => {
    let items = data?.data ?? [];
    if (tab === "mine" && user) {
      items = items.filter((c) => c.assignedOfficerId === user.id);
    }
    if (clusterFilter === "clustered") items = items.filter((c) => c.clusterId != null);
    else if (clusterFilter === "standalone")
      items = items.filter((c) => c.clusterId == null);
    else if (clusterFilter) items = items.filter((c) => c.clusterId === clusterFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter(
        (c) =>
          c.id.toLowerCase().includes(q) || c.category.name.toLowerCase().includes(q),
      );
    }
    return items;
  }, [data, tab, user, search, clusterFilter]);

  /**
   * How many of the officer's currently-visible complaints belong to each
   * cluster. Drives both the filter's options and the per-row badge, which
   * reads "Cluster #4 · 3 here" rather than a bare id — the count is the part
   * that tells an officer these are one job, not three.
   */
  const clusterSizes = useMemo(() => {
    const sizes = new Map<string, number>();
    for (const complaint of data?.data ?? []) {
      if (complaint.clusterId)
        sizes.set(complaint.clusterId, (sizes.get(complaint.clusterId) ?? 0) + 1);
    }
    return sizes;
  }, [data]);

  const clusterOptions = useMemo(
    () => [
      { value: "", label: "All complaints" },
      { value: "clustered", label: "In a cluster" },
      { value: "standalone", label: "Standalone only" },
      ...[...clusterSizes.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([id, count]) => ({
          value: id,
          label: `Cluster #${id} (${count})`,
        })),
    ],
    [clusterSizes],
  );

  const { sorted, sort, toggleSort } = useSortableRows(rows, QUEUE_COMPARATORS);

  const selectedRows = useMemo(
    () => rows.filter((c) => selected.has(c.id)),
    [rows, selected],
  );
  const selectedClaimableCount = selectedRows.filter(
    (c) => c.status === "SUBMITTED",
  ).length;
  const selectedClusterCount = new Set(
    selectedRows.map((c) => c.clusterId).filter(Boolean),
  ).size;

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
  const hasFilters =
    categoryId !== "" || severity !== "" || search.trim() !== "" || clusterFilter !== "";

  function clearFilters() {
    setRawSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of ["category", "severity", "q", "cluster"]) next.delete(key);
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

  /**
   * Claim every selected SUBMITTED complaint.
   *
   * There is no batch-claim endpoint — claiming is deliberately one
   * conditional UPDATE per complaint, which is what makes two officers racing
   * for the same row resolve to exactly one winner. So this drives the same
   * single-complaint endpoint the Claim button does, sequentially, and reports
   * per-item outcomes the way the batch-status endpoint does: losing a race on
   * three of eight is a normal result here, not a failure of the action.
   */
  async function handleBatchClaim() {
    const claimable = rows.filter((c) => selected.has(c.id) && c.status === "SUBMITTED");
    if (claimable.length === 0) {
      toast({
        title: "Nothing to claim",
        description: "Only complaints still awaiting a first review can be claimed.",
        variant: "default",
      });
      return;
    }

    setBatchClaiming(true);
    let claimed = 0;
    const failed: string[] = [];
    try {
      for (const complaint of claimable) {
        try {
          await claim.mutateAsync(complaint.id);
          claimed += 1;
        } catch {
          // Almost always a 409: another officer got there first, or the row
          // moved on between the queue being fetched and this running.
          failed.push(complaint.id);
        }
      }
    } finally {
      setBatchClaiming(false);
    }

    setSelected(new Set());
    toast({
      title:
        claimed > 0
          ? `Claimed ${claimed} complaint${claimed === 1 ? "" : "s"}`
          : "Couldn't claim any of those",
      description:
        failed.length > 0
          ? `${failed.length} were already taken or had moved on: ${failed.join(", ")}`
          : "They're now in your evidence-review queue.",
      variant: claimed > 0 ? "success" : "error",
    });
  }

  async function handleClaim(complaintId: string) {
    setClaimingId(complaintId);
    try {
      await claim.mutateAsync(complaintId);
      toast({
        title: t("officerQueue.claimed"),
        description: t("officerQueue.claimedBody"),
        variant: "success",
      });
    } catch (error) {
      toast({
        title: t("officerQueue.claimFailed"),
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
        <div className="flex items-center gap-2">
          <h1 className="font-display text-display-sm font-semibold text-ink">
            {t("officerQueue.title")}
          </h1>
          <RefreshButton onRefresh={refetch} refreshing={isFetching} what="the queue" />
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as QueueTab);
          resetForFilterChange();
        }}
      >
        <TabsList>
          {(Object.keys(TAB_LABEL_KEYS) as QueueTab[]).map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(TAB_LABEL_KEYS[key])}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap gap-4 rounded-lg border border-line bg-surface p-4">
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="queue-search">{t("filters.search")}</Label>
          <Input
            id="queue-search"
            leftIcon={<Search className="size-4" aria-hidden="true" />}
            placeholder={t("officerQueue.searchPlaceholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetForFilterChange();
            }}
          />
        </div>
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="queue-category">{t("filters.category")}</Label>
          <Combobox
            id="queue-category"
            value={categoryId}
            onChange={(value) => {
              setCategoryId(value);
              resetForFilterChange();
            }}
            options={[
              { value: "", label: t("filters.allCategories") },
              ...(categories?.map((c) => ({ value: c.id, label: c.name })) ?? []),
            ]}
          />
        </div>
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="queue-severity">{t("filters.severity")}</Label>
          <Combobox
            id="queue-severity"
            value={severity}
            onChange={(value) => {
              setSeverity(value as SeverityLabel | "");
              resetForFilterChange();
            }}
            options={[
              { value: "", label: t("filters.allSeverities") },
              ...SEVERITY_VALUES.map((value) => ({
                value,
                label: t(`severity.${value}`),
              })),
            ]}
          />
        </div>
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="queue-cluster">Cluster</Label>
          <Combobox
            id="queue-cluster"
            value={clusterFilter}
            onChange={(value) => {
              setClusterFilter(value);
              resetForFilterChange();
            }}
            options={clusterOptions}
          />
        </div>
        {hasFilters && (
          <div className="flex items-end">
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="size-3.5" aria-hidden="true" />
              {t("filters.clear")}
            </Button>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="bg-brand/10 border-brand/30 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
          <p className="text-sm font-medium text-ink">
            {t("officerQueue.selected", { count: selected.size })}
            {selectedClusterCount > 0 && (
              <span className="text-ink-muted font-normal">
                {t("officerQueue.selectedClusters", {
                  count: selectedClusterCount,
                })}
              </span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              <X className="size-4" aria-hidden="true" />
              {t("notifications.clear")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={batchClaiming}
              disabled={selectedClaimableCount === 0}
              onClick={handleBatchClaim}
            >
              <Hand className="size-4" aria-hidden="true" />
              Claim {selectedClaimableCount > 0 ? selectedClaimableCount : ""}
            </Button>
            <Button size="sm" onClick={() => setBatchOpen(true)}>
              {t("officerQueue.batchUpdate")}
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
          title={t("officerQueue.noMatch")}
          description={t("officerQueue.noMatchBody")}
          className="rounded-lg border border-line bg-surface"
        />
      ) : (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell className="w-10">
                  <Checkbox
                    aria-label={t("officerQueue.selectAll")}
                    checked={allSelectedOnPage}
                    indeterminate={someSelectedOnPage}
                    onChange={toggleSelectAll}
                    disabled={selectablePageIds.length === 0}
                  />
                </TableHeaderCell>
                <TableHeaderCell className="w-14">{t("columns.photo")}</TableHeaderCell>
                <SortableHeaderCell {...sortableProps("category")}>
                  {t("filters.category")}
                </SortableHeaderCell>
                <SortableHeaderCell {...sortableProps("status")}>
                  {t("filters.status")}
                </SortableHeaderCell>
                <SortableHeaderCell {...sortableProps("severity")}>
                  {t("filters.severity")}
                </SortableHeaderCell>
                <SortableHeaderCell {...sortableProps("sla")}>
                  {t("columns.sla")}
                </SortableHeaderCell>
                <SortableHeaderCell {...sortableProps("upvotes")}>
                  {t("columns.upvotes")}
                </SortableHeaderCell>
                <TableHeaderCell>{t("columns.assigned")}</TableHeaderCell>
                <SortableHeaderCell {...sortableProps("createdAt")}>
                  {t("columns.filed")}
                </SortableHeaderCell>
                <TableHeaderCell className="text-right">
                  {t("columns.actions")}
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paged.length === 0 ? (
                <DataTableEmpty colSpan={10}>
                  <p className="text-ink-muted text-sm">{t("officerQueue.emptyPage")}</p>
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
                        aria-label={t("officerQueue.selectRow", { complaintId: c.id })}
                        checked={selected.has(c.id)}
                        onChange={() => toggleRow(c.id)}
                        disabled={c.status === "REOPENED"}
                        title={
                          c.status === "REOPENED"
                            ? t("officerQueue.reopenedLocked")
                            : undefined
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/officer/queue/${c.id}`}
                        className="bg-surface-hover flex size-10 items-center justify-center overflow-hidden rounded-md"
                        aria-label={t("officerQueue.openRow", { complaintId: c.id })}
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
                      {c.clusterId && (
                        <Link
                          to={`/officer/clusters/${c.clusterId}`}
                          title={`One of ${clusterSizes.get(c.clusterId) ?? 1} reports of the same issue — open the cluster`}
                          className="text-brand bg-brand/10 mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium hover:underline"
                        >
                          <Layers className="size-3" aria-hidden="true" />
                          Cluster #{c.clusterId}
                          {(clusterSizes.get(c.clusterId) ?? 0) > 1 &&
                            ` · ${clusterSizes.get(c.clusterId)} here`}
                        </Link>
                      )}
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
                        ? t("officerQueue.tabs.unassigned")
                        : c.assignedOfficerId === user?.id
                          ? t("statusTimeline.you")
                          : t("statusTimeline.officer", {
                              officerId: c.assignedOfficerId,
                            })}
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
                          {t("officerQueue.claim")}
                        </Button>
                      ) : (
                        <Link
                          to={`/officer/queue/${c.id}`}
                          className="text-brand text-sm font-medium hover:underline"
                        >
                          {t("common.view")}
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
