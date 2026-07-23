import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Gavel } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { Label } from "@/components/ui/Label";
import { Combobox } from "@/components/ui/Combobox";
import { SeverityPill, SlaPill } from "@/components/ui/pills";
import { DynamicIcon } from "@/components/DynamicIcon";
import { useAdminComplaints } from "@/hooks/useAdminComplaints";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime } from "@/lib/datetime";

const PAGE_SIZE = 15;

export function AdminDisputesPage() {
  const [page, setPage] = useState(1);
  const [zoneId, setZoneId] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const { data, isLoading } = useAdminComplaints({
    status: ["REOPENED"],
    zoneId: zoneId || undefined,
    categoryId: categoryId || undefined,
    sort: "-createdAt",
    page,
    pageSize: PAGE_SIZE,
  });
  const rows = data?.data ?? [];

  // Filter dropdown options are derived from this same REOPENED query's
  // result rather than fetching /zones or /categories — this page issues
  // exactly one request. Options reflect whichever zone/category the
  // current filter selection has already surfaced.
  const zoneOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of data?.data ?? []) {
      if (c.zoneId) map.set(c.zoneId, c.zoneName ?? c.zoneId);
    }
    return map;
  }, [data]);
  const categoryOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of data?.data ?? []) {
      map.set(c.category.id, c.category.name);
    }
    return map;
  }, [data]);

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

  function resetPage() {
    setPage(1);
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-display-sm font-semibold text-ink">
          Dispute Queue
        </h1>
        <p className="text-ink-muted mt-1 text-sm">
          Complaints a citizen disputed after resolution — each is waiting for your
          ruling.
        </p>
        {summary && (
          <p className="text-ink-muted mt-2 text-sm">
            <span className="font-medium text-ink">{summary.total}</span> dispute
            {summary.total === 1 ? "" : "s"} pending, oldest filed {summary.oldestAgo}.
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
              ...[...zoneOptions.entries()].map(([id, name]) => ({
                value: id,
                label: name,
              })),
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
              ...[...categoryOptions.entries()].map(([id, name]) => ({
                value: id,
                label: name,
              })),
            ]}
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
            {rows.map((c) => (
              <Link
                key={c.id}
                to={`/admin/complaints/${c.id}`}
                className="flex items-center gap-4 rounded-lg border border-line bg-surface p-3 transition-colors hover:bg-surface-hover"
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
                  <p className="text-ink-faint font-mono text-xs">
                    {c.id} · disputed {relativeTime(c.updatedAt ?? c.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {c.severityLabel && <SeverityPill severity={c.severityLabel} />}
                  {c.slaLabel && <SlaPill sla={c.slaLabel} />}
                </div>
              </Link>
            ))}
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
