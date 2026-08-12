import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Gavel } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { Label } from "@/components/ui/Label";
import { Combobox } from "@/components/ui/Combobox";
import { SeverityPill, SlaPill } from "@/components/ui/pills";
import { DynamicIcon } from "@/components/DynamicIcon";
import { useAdminComplaints } from "@/hooks/useAdminComplaints";
import { useZones } from "@/hooks/useZones";
import { useCategories } from "@/hooks/useCategories";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { RefreshButton } from "@/components/ui/RefreshButton";

const PAGE_SIZE = 15;
// A dispute left un-ruled for a long time is the thing this page exists to
// surface, so "how old is the oldest one" needs a population independent of
// whatever zone/category filter and page the admin currently has selected.
const OVERDUE_THRESHOLD_HOURS = 72;
const STATS_FETCH_SIZE = 100;

const SORT_OPTIONS = [
  { value: "updatedAt", label: "Oldest disputed first" },
  { value: "-updatedAt", label: "Newest disputed first" },
];

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

export function AdminDisputesPage() {
  const [page, setPage] = useState(1);
  const [zoneId, setZoneId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sort, setSort] = useState("updatedAt");

  const { data: zones } = useZones();
  const { data: categories } = useCategories();

  const { data, isLoading, isFetching, refetch } = useAdminComplaints({
    status: ["REOPENED"],
    zoneId: zoneId || undefined,
    categoryId: categoryId || undefined,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });
  const rows = data?.data ?? [];

  // Unfiltered snapshot used only to compute the age-based stats below —
  // independent of the zone/category filter and page selected above, so
  // narrowing the visible list doesn't change what counts as "overdue".
  const { data: allDisputes } = useAdminComplaints({
    status: ["REOPENED"],
    sort: "updatedAt",
    pageSize: STATS_FETCH_SIZE,
  });

  const summary = useMemo(() => {
    if (!data || data.data.length === 0) return null;
    const oldest = data.data.reduce((min, c) =>
      new Date(c.createdAt).getTime() < new Date(min.createdAt).getTime() ? c : min,
    );
    return {
      total: data.pagination.totalItems,
      oldestAgo: relativeTime(oldest.createdAt),
    };
  }, [data]);

  const overdueCount = useMemo(() => {
    if (!allDisputes) return 0;
    return allDisputes.data.filter(
      (c) => hoursSince(c.updatedAt ?? c.createdAt) >= OVERDUE_THRESHOLD_HOURS,
    ).length;
  }, [allDisputes]);

  function resetPage() {
    setPage(1);
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="font-display text-display-sm font-semibold text-ink">
            Dispute Queue
          </h1>
          <RefreshButton onRefresh={refetch} refreshing={isFetching} what="disputes" />
        </div>
        <p className="text-ink-muted mt-1 text-sm">
          Complaints a citizen disputed after resolution — each is waiting for your
          ruling.
        </p>
        {summary && (
          <p className="text-ink-muted mt-2 text-sm">
            <span className="font-medium text-ink">{summary.total}</span> dispute
            {summary.total === 1 ? "" : "s"} pending, oldest filed {summary.oldestAgo}.
            {overdueCount > 0 && (
              <span className="text-sla-overdue ml-2 inline-flex items-center gap-1 font-medium">
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                {overdueCount} waiting {OVERDUE_THRESHOLD_HOURS}h+
              </span>
            )}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-4 rounded-lg border border-line bg-surface p-4">
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="dispute-zone-filter">Zone</Label>
          <Combobox
            id="dispute-zone-filter"
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
          <Label htmlFor="dispute-category-filter">Category</Label>
          <Combobox
            id="dispute-category-filter"
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
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="dispute-sort">Sort by</Label>
          <Combobox
            id="dispute-sort"
            value={sort}
            onChange={(v) => {
              setSort(v);
              resetPage();
            }}
            options={SORT_OPTIONS}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title="No pending disputes"
          description="When a citizen disputes a resolution, it'll show up here for your ruling."
          className="rounded-lg border border-line bg-surface"
        />
      ) : (
        <>
          <div className="space-y-2">
            {rows.map((c) => {
              const age = hoursSince(c.updatedAt ?? c.createdAt);
              const overdue = age >= OVERDUE_THRESHOLD_HOURS;
              return (
                <Link
                  key={c.id}
                  to={`/admin/complaints/${c.id}`}
                  className={cn(
                    "flex items-center gap-4 rounded-lg border p-3 transition-colors hover:bg-surface-hover",
                    overdue
                      ? "border-sla-overdue/40 bg-sla-overdue-subtle"
                      : "border-line bg-surface",
                  )}
                >
                  <span className="bg-surface-hover flex size-11 shrink-0 items-center justify-center rounded-full">
                    <DynamicIcon
                      icon={iconForCategory(c.category.name)}
                      className="text-ink-muted size-5"
                      aria-hidden="true"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {c.category.name} · {c.zoneName}
                    </p>
                    <p
                      className={cn(
                        "font-mono text-xs",
                        overdue ? "text-sla-overdue font-semibold" : "text-ink-faint",
                      )}
                    >
                      {c.id} · disputed {relativeTime(c.updatedAt ?? c.createdAt)}
                      {overdue && " · overdue for ruling"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {c.severityLabel && <SeverityPill severity={c.severityLabel} />}
                    {c.slaLabel && <SlaPill sla={c.slaLabel} />}
                  </div>
                </Link>
              );
            })}
          </div>
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
