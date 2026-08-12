import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Camera,
  CheckCircle2,
  ClipboardList,
  FilePlus2,
  Search,
  TimerOff,
  X,
} from "lucide-react";
import { Combobox } from "@/components/ui/Combobox";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { LinkButton } from "@/components/ui/LinkButton";
import { ComplaintListItem } from "@/components/complaint/ComplaintListItem";
import { ConfirmFixButton } from "@/components/complaint/ConfirmFixButton";
import { useMyComplaints } from "@/hooks/useMyComplaints";
import { useCategories } from "@/hooks/useCategories";
import { useZones } from "@/hooks/useZones";
import { useSearchParamState } from "@/hooks/useSearchParamState";
import { cn } from "@/lib/utils";
import type { Complaint, ComplaintStatus } from "@/types/api";
import { RefreshButton } from "@/components/ui/RefreshButton";

const STATUSES: ComplaintStatus[] = [
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

const STATUS_LABELS: Record<ComplaintStatus, string> = {
  SUBMITTED: "Submitted",
  EVIDENCE_UNDER_REVIEW: "Evidence under review",
  NEEDS_MORE_EVIDENCE: "Needs more evidence",
  REJECTED: "Rejected",
  UNDER_REVIEW: "Under review",
  IN_PROGRESS: "In progress",
  UNDER_RESOLUTION: "Under resolution",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  UNRESOLVABLE: "Unresolvable",
};

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "-createdAt", label: "Newest first" },
  { value: "createdAt", label: "Oldest first" },
  { value: "-updatedAt", label: "Recently updated" },
  { value: "-severity", label: "Severity (highest first)" },
  { value: "-sla", label: "SLA (most overdue first)" },
  { value: "-upvotes", label: "Most upvoted" },
];

// Mirrors the citizen dashboard's own buckets — used only so the dashboard's
// "Active"/"Resolved" stat cards can deep-link here with `?bucket=`, since
// the status filter above is single-select and neither bucket maps to one
// ComplaintStatus.
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
type Bucket = "" | "active" | "resolved";

/**
 * `""` = off, `"1"` = any action (what the dashboard tile deep-links to),
 * or one specific `citizenActionNeeded` value. Kept as one param so the
 * existing `?action=1` links keep working.
 */
type ActionFilter = "" | "1" | NonNullable<Complaint["citizenActionNeeded"]>;

const PAGE_SIZE = 10;
// A larger single fetch used only while a client-only filter (zone, action-
// needed, bucket, SLA, search) is active, mirroring the officer queue's
// pattern — the API has no query params for any of these, so they narrow a
// generously sized page client-side, then get paginated locally, keeping the
// displayed count and page count honest instead of reflecting the unfiltered
// server total.
const FETCH_SIZE = 100;

export function MyComplaintsPage() {
  const [status, setStatus] = useSearchParamState<ComplaintStatus | "">("status", "");
  const [categoryId, setCategoryId] = useSearchParamState("category", "");
  const [zoneId, setZoneId] = useSearchParamState("zone", "");
  const [sort, setSort] = useSearchParamState("sort", "-createdAt");
  const [actionFilter, setActionFilter] = useSearchParamState<ActionFilter>("action", "");
  // `slaLabel` is derived server-side and returned on every list row, but
  // there's no query param for it — so it narrows client-side like the rest.
  const [lateOnly, setLateOnly] = useSearchParamState("late", false, {
    serialize: (v: boolean) => (v ? "1" : undefined),
    deserialize: (raw: string) => raw === "1",
  });
  const [search, setSearch] = useSearchParamState("q", "");
  const [bucket, setBucket] = useSearchParamState<Bucket>("bucket", "");
  const [page, setPage] = useState(1);
  // Bypasses the per-field setters above for the "clear everything" case:
  // each of those closes over its own snapshot of the URL from this render,
  // so calling several back to back makes each one clobber the previous
  // one's change instead of composing — only the last field would clear.
  // One functional update drops every filter key in a single navigation.
  const [, setRawSearchParams] = useSearchParams();

  const { data: categories } = useCategories();
  const { data: zones } = useZones();

  const hasClientOnlyFilter =
    zoneId !== "" ||
    actionFilter !== "" ||
    lateOnly ||
    bucket !== "" ||
    search.trim() !== "";

  const { data, isLoading, isFetching, refetch } = useMyComplaints({
    page: hasClientOnlyFilter ? 1 : page,
    pageSize: hasClientOnlyFilter ? FETCH_SIZE : PAGE_SIZE,
    sort,
    status: status ? [status] : undefined,
    categoryId: categoryId || undefined,
  });

  const allComplaints = useMemo(() => data?.data ?? [], [data]);

  const matchesBucket = (c: Complaint) =>
    bucket === "active"
      ? ACTIVE_STATUSES.has(c.status)
      : bucket === "resolved"
        ? RESOLVED_STATUSES.has(c.status)
        : true;

  const matchesAction = (c: Complaint) =>
    actionFilter === ""
      ? true
      : actionFilter === "1"
        ? c.citizenActionNeeded != null
        : c.citizenActionNeeded === actionFilter;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allComplaints.filter(
      (c) =>
        (!zoneId || c.zoneId === zoneId) &&
        matchesAction(c) &&
        (!lateOnly || c.slaLabel === "DELAYED" || c.slaLabel === "OVERDUE") &&
        matchesBucket(c) &&
        (!q ||
          c.id.toLowerCase().includes(q) ||
          c.category.name.toLowerCase().includes(q) ||
          (c.zoneName?.toLowerCase().includes(q) ?? false)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allComplaints, zoneId, actionFilter, lateOnly, bucket, search]);

  const confirmCount = useMemo(
    () => allComplaints.filter((c) => c.citizenActionNeeded === "CONFIRM_FIX").length,
    [allComplaints],
  );
  const evidenceCount = useMemo(
    () =>
      allComplaints.filter((c) => c.citizenActionNeeded === "PROVIDE_MORE_EVIDENCE")
        .length,
    [allComplaints],
  );

  const total = hasClientOnlyFilter
    ? filtered.length
    : (data?.pagination.totalItems ?? 0);
  const complaints = hasClientOnlyFilter
    ? filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : filtered;

  const hasFilters =
    status !== "" ||
    categoryId !== "" ||
    zoneId !== "" ||
    actionFilter !== "" ||
    lateOnly ||
    bucket !== "" ||
    search !== "";

  function resetPage() {
    setPage(1);
  }

  function clearFilters() {
    setRawSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of [
          "status",
          "category",
          "zone",
          "action",
          "late",
          "bucket",
          "q",
        ]) {
          next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
    setPage(1);
  }

  function toggleAction(value: Exclude<ActionFilter, "">) {
    setActionFilter(actionFilter === value ? "" : value);
    resetPage();
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-display-sm font-semibold text-ink">
            My Complaints
          </h1>
          <RefreshButton
            onRefresh={refetch}
            refreshing={isFetching}
            what="my complaints"
          />
        </div>
        <LinkButton to="/citizen/file">
          <FilePlus2 className="size-4" aria-hidden="true" />
          File a complaint
        </LinkButton>
      </div>

      {(confirmCount > 0 || evidenceCount > 0) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {confirmCount > 0 && (
            <AttentionBanner
              tone="good"
              icon={CheckCircle2}
              active={actionFilter === "CONFIRM_FIX"}
              onClick={() => toggleAction("CONFIRM_FIX")}
              label={
                confirmCount === 1
                  ? "1 fix waiting for your confirmation"
                  : `${confirmCount} fixes waiting for your confirmation`
              }
            />
          )}
          {evidenceCount > 0 && (
            <AttentionBanner
              tone="warning"
              icon={Camera}
              active={actionFilter === "PROVIDE_MORE_EVIDENCE"}
              onClick={() => toggleAction("PROVIDE_MORE_EVIDENCE")}
              label={
                evidenceCount === 1
                  ? "1 report needs a clearer photo"
                  : `${evidenceCount} reports need a clearer photo`
              }
            />
          )}
        </div>
      )}

      <div className="space-y-4 rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap gap-4">
          <div className="min-w-[12rem] flex-1">
            <Label htmlFor="complaints-search">Search</Label>
            <Input
              id="complaints-search"
              leftIcon={<Search className="size-4" aria-hidden="true" />}
              placeholder="Complaint ID, category or zone…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetPage();
              }}
            />
          </div>
          <div className="min-w-[10rem] flex-1">
            <Label htmlFor="status-filter">Status</Label>
            <Combobox
              id="status-filter"
              value={status}
              onChange={(v) => {
                setStatus(v as ComplaintStatus | "");
                resetPage();
              }}
              options={[
                { value: "", label: "All statuses" },
                ...STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
              ]}
            />
          </div>
          <div className="min-w-[10rem] flex-1">
            <Label htmlFor="category-filter">Category</Label>
            <Combobox
              id="category-filter"
              value={categoryId}
              onChange={(v) => {
                setCategoryId(v);
                resetPage();
              }}
              options={[
                { value: "", label: "All categories" },
                ...(categories?.map((c) => ({ value: c.id, label: c.name })) ?? []),
              ]}
            />
          </div>
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
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            active={actionFilter !== ""}
            onClick={() => {
              setActionFilter(actionFilter !== "" ? "" : "1");
              resetPage();
            }}
          >
            Needs my action
          </FilterChip>
          <FilterChip
            active={bucket === "active"}
            onClick={() => {
              setBucket(bucket === "active" ? "" : "active");
              resetPage();
            }}
          >
            Active only
          </FilterChip>
          <FilterChip
            active={bucket === "resolved"}
            onClick={() => {
              setBucket(bucket === "resolved" ? "" : "resolved");
              resetPage();
            }}
          >
            Resolved only
          </FilterChip>
          <FilterChip
            active={lateOnly}
            onClick={() => {
              setLateOnly(!lateOnly);
              resetPage();
            }}
          >
            <TimerOff className="size-3" aria-hidden="true" />
            Running late
          </FilterChip>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="size-3.5" aria-hidden="true" />
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-[4.5rem] w-full" />
          ))}
        </div>
      ) : complaints.length === 0 ? (
        <EmptyState
          icon={hasFilters ? ClipboardList : FilePlus2}
          title={hasFilters ? "No complaints match these filters" : "No complaints yet"}
          description={
            hasFilters
              ? "Try a different status, category, or zone."
              : "Report your first civic issue — a photo, a pin on the map, and a category is all it takes."
          }
          action={
            !hasFilters && <LinkButton to="/citizen/file">File a complaint</LinkButton>
          }
          className="rounded-lg border border-line bg-surface"
        />
      ) : (
        <>
          <p className="text-ink-faint text-xs">
            Showing {complaints.length} of {total}{" "}
            {total === 1 ? "complaint" : "complaints"}
          </p>
          <div className="space-y-2">
            {complaints.map((c) => (
              <ComplaintListItem
                key={c.id}
                complaint={c}
                to={`/citizen/complaints/${c.id}`}
                showZone
                showUpdatedAt
                action={
                  c.citizenActionNeeded === "CONFIRM_FIX" ? (
                    <ConfirmFixButton complaintId={c.id} />
                  ) : undefined
                }
              />
            ))}
          </div>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-brand text-brand-fg"
          : "bg-surface-hover text-ink-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

const BANNER_TONES = {
  good: "border-status-resolved/40 bg-status-resolved-subtle text-status-resolved",
  warning:
    "border-status-needs_more_evidence/40 bg-status-needs_more_evidence-subtle text-status-needs_more_evidence",
} as const;

function AttentionBanner({
  tone,
  icon: Icon,
  label,
  active,
  onClick,
}: {
  tone: keyof typeof BANNER_TONES;
  icon: typeof CheckCircle2;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border px-4 py-3 text-left text-sm font-medium transition-[filter,box-shadow] hover:brightness-95",
        BANNER_TONES[tone],
        active && "ring-2 ring-current",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {label}
      <span className="ml-auto shrink-0 text-xs underline">
        {active ? "Clear" : "Show"}
      </span>
    </button>
  );
}
