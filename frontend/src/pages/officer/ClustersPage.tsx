import { useState } from "react";
import { Link } from "react-router-dom";
import { Boxes } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { SeverityPill } from "@/components/ui/pills";
import { DynamicIcon } from "@/components/DynamicIcon";
import { useClusters } from "@/hooks/useClusters";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime } from "@/lib/datetime";
import type { ComplaintStatus } from "@/types/api";

const PAGE_SIZE = 12;

const STATUS_ORDER: ComplaintStatus[] = [
  "SUBMITTED",
  "EVIDENCE_UNDER_REVIEW",
  "NEEDS_MORE_EVIDENCE",
  "UNDER_REVIEW",
  "IN_PROGRESS",
  "UNDER_RESOLUTION",
  "RESOLVED",
  "REOPENED",
  "CLOSED",
  "REJECTED",
  "UNRESOLVABLE",
];

export function OfficerClustersPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useClusters({ page, pageSize: PAGE_SIZE });
  const clusters = data?.data ?? [];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <h1 className="font-display text-display-sm font-semibold text-ink">Clusters</h1>
      <p className="text-ink-muted -mt-4 text-sm">
        Nearby same-category reports grouped as one physical issue in your zone.
      </p>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : clusters.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No clusters yet"
          description="When several nearby citizens report the same issue, they'll be grouped here."
          className="rounded-lg border border-line bg-surface"
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {clusters.map((cluster) => {
              const statuses = STATUS_ORDER.filter((s) => cluster.statusSummary[s]);
              return (
                <Link
                  key={cluster.id}
                  to={`/officer/clusters/${cluster.id}`}
                  className="space-y-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:bg-surface-hover"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="bg-surface-hover flex size-9 shrink-0 items-center justify-center rounded-full">
                        <DynamicIcon
                          icon={iconForCategory(cluster.category.name)}
                          className="text-ink-muted size-4"
                          aria-hidden="true"
                        />
                      </span>
                      <div>
                        <p className="font-medium text-ink">{cluster.category.name}</p>
                        <p className="text-ink-faint font-mono text-xs">{cluster.id}</p>
                      </div>
                    </div>
                    <SeverityPill severity={cluster.severityLabel} />
                  </div>

                  <div className="text-ink-muted flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span>
                      {cluster.reportCount} report{cluster.reportCount === 1 ? "" : "s"}
                    </span>
                    <span>
                      {cluster.uniqueReporterCount} unique reporter
                      {cluster.uniqueReporterCount === 1 ? "" : "s"}
                    </span>
                    <span>{relativeTime(cluster.createdAt)}</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {statuses.map((status) => (
                      <span
                        key={status}
                        className="bg-surface-hover text-ink-muted rounded-full px-2 py-0.5 text-xs"
                      >
                        {cluster.statusSummary[status]} {status.replace(/_/g, " ").toLowerCase()}
                      </span>
                    ))}
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
