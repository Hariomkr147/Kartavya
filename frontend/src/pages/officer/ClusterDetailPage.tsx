import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Boxes, FileQuestion } from "lucide-react";
import { StatusPill, SeverityPill, SlaPill } from "@/components/ui/pills";
import { PhotoThumb } from "@/components/ui/PhotoThumb";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { Label } from "@/components/ui/Label";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { DynamicIcon } from "@/components/DynamicIcon";
import { BatchStatusModal } from "@/components/complaint/BatchStatusModal";
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
import { useAuth } from "@/contexts/AuthContext";
import { useCluster } from "@/hooks/useCluster";
import { useAddClusterProgressNote } from "@/hooks/useAddClusterProgressNote";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime } from "@/lib/datetime";
import { ApiRequestError } from "@/services/http";
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

export function OfficerClusterDetailPage() {
  const { t } = useTranslation();
  const { clusterId } = useParams<{ clusterId: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const {
    data: cluster,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useCluster(clusterId);
  const addClusterNote = useAddClusterProgressNote(clusterId ?? "");
  const { record: recordRecentlyViewed } = useRecentlyViewed(
    `officer:${user?.id ?? "anon"}`,
  );

  const [batchOpen, setBatchOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    if (!cluster) return;
    recordRecentlyViewed({
      id: cluster.id,
      label: cluster.category.name,
      sublabel: cluster.id,
      href: `/officer/clusters/${cluster.id}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster?.id]);

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
        description={t("clusterDetail.notFoundBody")}
        action={
          <Link
            to="/officer/clusters"
            className="text-brand text-sm font-medium hover:underline"
          >
            {t("clusterDetail.backToClusters")}
          </Link>
        }
        className="mx-auto max-w-md py-24"
      />
    );
  }

  const statuses = STATUS_ORDER.filter((s) => cluster.statusSummary[s]);
  const statusChartData = statuses.map((status) => ({
    label: t(`status.${status}`),
    value: cluster.statusSummary[status],
  }));

  async function handleAddNote() {
    setNoteError(null);
    if (!noteText.trim()) {
      setNoteError(t("clusterDetail.noteRequired"));
      return;
    }
    try {
      const created = await addClusterNote.mutateAsync(noteText.trim());
      toast({
        title: t("clusterDetail.notePosted"),
        description: t("clusterDetail.notePostedBody", {
          created: created.length,
          total: cluster!.complaints.length,
        }),
        variant: "success",
      });
      setNoteOpen(false);
      setNoteText("");
    } catch (error) {
      setNoteError(
        error instanceof ApiRequestError
          ? error.message
          : t("errors.generic"),
      );
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-12">
      <Link
        to="/officer/clusters"
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
              {t("clusterDetail.formedLine", {
                clusterId: cluster.id,
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

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setBatchOpen(true)}>
          <Boxes className="size-4" aria-hidden="true" />
          {t("officerQueue.batchUpdate")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setNoteOpen(true)}>
          {t("clusterDetail.addNoteToAll")}
        </Button>
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
                    to={`/officer/queue/${c.id}`}
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
                    to={`/officer/queue/${c.id}`}
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

      <BatchStatusModal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        target={{ type: "cluster", clusterId: cluster.id }}
        statuses={cluster.complaints.map((c) => c.status)}
      />

      <Modal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title={t("clusterDetail.addNoteTitle")}
        description={t("clusterDetail.addNoteBody")}
        footer={
          <>
            <Button variant="outline" onClick={() => setNoteOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button loading={addClusterNote.isPending} onClick={handleAddNote}>
              {t("clusterDetail.postNote")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {noteError && (
            <p
              role="alert"
              className="bg-status-rejected-subtle text-status-rejected rounded-md px-3 py-2 text-sm"
            >
              {noteError}
            </p>
          )}
          <div>
            <Label htmlFor="cluster-note" required>
              {t("clusterDetail.note")}
            </Label>
            <Textarea
              id="cluster-note"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={t("clusterDetail.notePlaceholder")}
              maxLength={500}
            />
          </div>
        </div>
      </Modal>
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
