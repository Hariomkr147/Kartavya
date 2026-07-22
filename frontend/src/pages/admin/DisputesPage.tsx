import { useState } from "react";
import { Link } from "react-router-dom";
import { Gavel } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { SeverityPill, SlaPill } from "@/components/ui/pills";
import { DynamicIcon } from "@/components/DynamicIcon";
import { useAdminComplaints } from "@/hooks/useAdminComplaints";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime } from "@/lib/datetime";

const PAGE_SIZE = 15;

export function AdminDisputesPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useAdminComplaints({
    status: ["REOPENED"],
    sort: "-createdAt",
    page,
    pageSize: PAGE_SIZE,
  });
  const rows = data?.data ?? [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-display-sm font-semibold text-ink">
          Dispute Queue
        </h1>
        <p className="text-ink-muted mt-1 text-sm">
          Complaints a citizen disputed after resolution — each is waiting for your ruling.
        </p>
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
