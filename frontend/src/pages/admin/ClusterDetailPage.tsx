import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileQuestion } from "lucide-react";
import { StatusPill, SeverityPill, SlaPill } from "@/components/ui/pills";
import { PhotoThumb } from "@/components/ui/PhotoThumb";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { DynamicIcon } from "@/components/DynamicIcon";
import { MiniMap } from "@/components/ui/MiniMap";
import { HorizontalBarChart } from "@/components/charts/HorizontalBarChart";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/ui/DataTable";
import { useCluster } from "@/hooks/useCluster";
import { useZones } from "@/hooks/useZones";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime } from "@/lib/datetime";
import type { ComplaintStatus } from "@/types/api";
import { RefreshButton } from "@/components/ui/RefreshButton";

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

export function AdminClusterDetailPage() {
  const { t } = useTranslation();
  const { clusterId } = useParams<{ clusterId: string }>();
  const {
    data: cluster,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useCluster(clusterId);
  const { data: zones } = useZones();

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !cluster) {
    return (
      <EmptyState
        icon={FileQuestion}
        title={t("clusterDetail.notFound")}
        action={
          <Link
            to="/admin/clusters"
            className="text-brand text-sm font-medium hover:underline"
          >
            {t("clusterDetail.backToClusters")}
          </Link>
        }
        className="mx-auto max-w-md py-24"
      />
    );
  }

  const zoneName = zones?.find((z) => z.id === cluster.zoneId)?.name ?? cluster.zoneId;
  const statuses = STATUS_ORDER.filter((s) => cluster.statusSummary[s]);
  const statusChartData = statuses.map((status) => ({
    label: t(`status.${status}`),
    value: cluster.statusSummary[status],
  }));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-12">
      <Link
        to="/admin/clusters"
        className="text-ink-muted inline-flex items-center gap-1.5 text-sm hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("nav.clusters")}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="bg-surface-hover flex size-11 shrink-0 items-center justify-center rounded-full">
            <DynamicIcon
              icon={iconForCategory(cluster.category.name)}
              className="text-ink-muted size-5"
              aria-hidden="true"
            />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold text-ink">
                {cluster.category.name}
              </h1>
              <RefreshButton onRefresh={refetch} refreshing={isFetching} what="this cluster" />
            </div>
            <p className="text-ink-faint font-mono text-xs">
              {t("adminClusterDetail.formedLine", {
                clusterId: cluster.id,
                zone: zoneName,
                when: relativeTime(cluster.createdAt),
              })}
            </p>
          </div>
        </div>
        <SeverityPill severity={cluster.severityLabel} />
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-3">
        <Stat label={t("clusterDetail.reports")} value={cluster.reportCount} />
        <Stat
          label={t("clusterDetail.uniqueReporters")}
          value={cluster.uniqueReporterCount}
        />
        <Stat label={t("clusterDetail.severityScore")} value={cluster.severityScore} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
        <div className="rounded-lg border border-line bg-surface p-4">
          <h2 className="font-display mb-3 text-base font-semibold text-ink">
            {t("clusterDetail.statusBreakdown")}
          </h2>
          <HorizontalBarChart data={statusChartData} />
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <h2 className="font-display mb-3 text-base font-semibold text-ink">
            {t("clusterDetail.centroid")}
          </h2>
          <MiniMap
            pins={[
              {
                id: cluster.id,
                lat: cluster.centroidLat,
                lng: cluster.centroidLng,
                label: cluster.category.name,
              },
            ]}
            height={200}
          />
        </div>
      </div>

      <section>
        <h2 className="font-display mb-3 text-base font-semibold text-ink">
          {t("clusterDetail.memberComplaints")}
        </h2>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell className="w-16">{t("columns.photo")}</TableHeaderCell>
              <TableHeaderCell>{t("columns.complaint")}</TableHeaderCell>
              <TableHeaderCell>{t("filters.status")}</TableHeaderCell>
              <TableHeaderCell>{t("filters.severity")}</TableHeaderCell>
              <TableHeaderCell>{t("columns.sla")}</TableHeaderCell>
              <TableHeaderCell>{t("columns.filed")}</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {cluster.complaints.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link
                    to={`/admin/complaints/${c.id}`}
                    className="bg-surface-hover flex size-10 items-center justify-center overflow-hidden rounded-md"
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
                    to={`/admin/complaints/${c.id}`}
                    className="text-ink font-mono text-xs hover:underline"
                  >
                    {c.id}
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
                  {relativeTime(c.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-ink-faint text-xs font-medium tracking-wide uppercase">
        {label}
      </p>
      <p className="mt-1 font-mono text-2xl font-semibold text-ink">{value}</p>
    </div>
  );
}
