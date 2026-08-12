import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  FileQuestion,
  Gavel,
  Layers,
  ShieldCheck,
  Sliders,
  UserRound,
} from "lucide-react";
import { StatusPill, SeverityPill, SlaPill } from "@/components/ui/pills";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Textarea } from "@/components/ui/Textarea";
import { Label } from "@/components/ui/Label";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { MiniMap } from "@/components/ui/MiniMap";
import { useToast } from "@/components/ui/Toast";
import { DynamicIcon } from "@/components/DynamicIcon";
import { EvidenceGallery } from "@/components/complaint/EvidenceGallery";
import { TimelineSidebar } from "@/components/complaint/TimelineSidebar";
import { useOfficerDirectory } from "@/hooks/useOfficerDirectory";
import { useComplaint } from "@/hooks/useComplaint";
import { useOverrideComplaint } from "@/hooks/useOverrideComplaint";
import { useReviewDispute } from "@/hooks/useReviewDispute";
import { useCategories } from "@/hooks/useCategories";
import { useZones } from "@/hooks/useZones";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime } from "@/lib/datetime";
import { ApiRequestError } from "@/services/http";
import type { ComplaintStatus, DisputeVerdict } from "@/types/api";
import { RefreshButton } from "@/components/ui/RefreshButton";

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

function humanizeStatus(status: ComplaintStatus): string {
  return status
    .toLowerCase()
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

const AT_OR_PAST_UNDER_REVIEW = new Set<ComplaintStatus>([
  "UNDER_REVIEW",
  "IN_PROGRESS",
  "UNDER_RESOLUTION",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "UNRESOLVABLE",
]);

export function AdminComplaintDetailPage() {
  const { complaintId } = useParams<{ complaintId: string }>();
  const { toast } = useToast();
  const {
    data: complaint,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useComplaint(complaintId);
  const { data: categories } = useCategories();
  const { data: zones } = useZones();
  const officers = useOfficerDirectory();

  const override = useOverrideComplaint(complaintId ?? "");
  const reviewDispute = useReviewDispute(complaintId ?? "");

  const [status, setStatus] = useState<ComplaintStatus | "">("");
  const [categoryId, setCategoryId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [reason, setReason] = useState("");
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideConfirmOpen, setOverrideConfirmOpen] = useState(false);

  const [verdict, setVerdict] = useState<DisputeVerdict | "">("");
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeError, setDisputeError] = useState<string | null>(null);
  const [disputeConfirmOpen, setDisputeConfirmOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError || !complaint) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Complaint not found"
        action={
          <Link
            to="/admin/complaints"
            className="text-brand text-sm font-medium hover:underline"
          >
            Back to Complaints
          </Link>
        }
        className="mx-auto max-w-md py-24"
      />
    );
  }

  const hasOverrideChanges =
    (status && status !== complaint.status) ||
    (categoryId && categoryId !== complaint.category.id) ||
    (zoneId && zoneId !== complaint.zoneId);

  function requestOverrideConfirmation() {
    setOverrideError(null);
    setOverrideConfirmOpen(true);
  }

  async function handleOverride() {
    setOverrideError(null);
    try {
      await override.mutateAsync({
        status: status || undefined,
        categoryId: categoryId || undefined,
        zoneId: zoneId || undefined,
        reason: reason.trim() || undefined,
      });
      toast({ title: "Override applied", variant: "success" });
      setStatus("");
      setCategoryId("");
      setZoneId("");
      setReason("");
      setOverrideConfirmOpen(false);
    } catch (error) {
      setOverrideError(
        error instanceof ApiRequestError
          ? error.message
          : "Something went wrong. Please try again.",
      );
    }
  }

  function requestDisputeConfirmation() {
    setDisputeError(null);
    if (!verdict) {
      setDisputeError("Choose a verdict.");
      return;
    }
    if (!disputeReason.trim()) {
      setDisputeError("A reason is required.");
      return;
    }
    setDisputeConfirmOpen(true);
  }

  async function handleDisputeReview() {
    setDisputeError(null);
    if (!verdict) {
      setDisputeError("Choose a verdict.");
      return;
    }
    if (!disputeReason.trim()) {
      setDisputeError("A reason is required.");
      return;
    }
    try {
      await reviewDispute.mutateAsync({ verdict, reason: disputeReason.trim() });
      toast({
        title: verdict === "UPHELD" ? "Dispute upheld" : "Dispute rejected",
        description:
          verdict === "UPHELD"
            ? "Sent back to the officer as In Progress."
            : "The original resolution stands; complaint closed.",
        variant: "success",
      });
      setVerdict("");
      setDisputeReason("");
      setDisputeConfirmOpen(false);
    } catch (error) {
      setDisputeError(
        error instanceof ApiRequestError
          ? error.message
          : "Something went wrong. Please try again.",
      );
    }
  }

  const willBackfillSla =
    status && AT_OR_PAST_UNDER_REVIEW.has(status) && complaint.slaTargetHours == null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-12">
      <Link
        to="/admin/complaints"
        className="text-ink-muted inline-flex items-center gap-1.5 text-sm hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Complaints
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="bg-surface-hover flex size-11 shrink-0 items-center justify-center rounded-full">
            <DynamicIcon
              icon={iconForCategory(complaint.category.name)}
              className="text-ink-muted size-5"
              aria-hidden="true"
            />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold text-ink">
                {complaint.category.name}
              </h1>
              <RefreshButton onRefresh={refetch} refreshing={isFetching} what="this complaint" />
            </div>
            <p className="text-ink-faint font-mono text-xs">
              {complaint.id} · {complaint.zoneName} · filed{" "}
              {relativeTime(complaint.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={complaint.status} />
          {complaint.severityLabel && <SeverityPill severity={complaint.severityLabel} />}
          {complaint.slaLabel && <SlaPill sla={complaint.slaLabel} />}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          {complaint.reporter && (
            <div className="flex items-center gap-2 rounded-md border border-line bg-surface p-3 text-sm">
              <UserRound className="text-ink-muted size-4 shrink-0" aria-hidden="true" />
              <span className="text-ink-muted">
                Reporter:{" "}
                <span className="font-medium text-ink">{complaint.reporter.name}</span>
                {complaint.reporter.email && ` · ${complaint.reporter.email}`}
                {complaint.reporter.displayName &&
                  ` · public handle "${complaint.reporter.displayName}"`}
              </span>
            </div>
          )}

          <div className="text-ink-muted flex items-center gap-2 rounded-md border border-line bg-surface p-3 text-sm">
            <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
            Assigned:{" "}
            {complaint.assignedOfficerId == null
              ? "Unassigned"
              : officers.describe(complaint.assignedOfficerId)}
          </div>

          {(complaint.severityScore != null || complaint.clusterId) && (
            <div className="text-ink-muted flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-md border border-line bg-surface p-3 text-sm">
              {complaint.severityScore != null && (
                <span>
                  Severity score:{" "}
                  <span className="font-mono font-medium text-ink">
                    {complaint.severityScore}
                  </span>
                </span>
              )}
              {complaint.clusterId && (
                <Link
                  to={`/admin/clusters/${complaint.clusterId}`}
                  className="hover:text-ink flex items-center gap-1.5 hover:underline"
                >
                  <Layers className="size-4 shrink-0" aria-hidden="true" />
                  Part of cluster{" "}
                  <span className="font-mono text-ink">{complaint.clusterId}</span>
                </Link>
              )}
            </div>
          )}

          {complaint.description && (
            <p className="text-ink-muted text-sm leading-relaxed">
              {complaint.description}
            </p>
          )}

          {complaint.latitude != null && complaint.longitude != null && (
            <section>
              <h2 className="font-display mb-3 text-base font-semibold text-ink">
                Location
              </h2>
              <MiniMap
                pins={[
                  {
                    id: complaint.id,
                    lat: complaint.latitude,
                    lng: complaint.longitude,
                    label: complaint.category.name,
                  },
                ]}
              />
            </section>
          )}

          {complaint.evidence && complaint.evidence.length > 0 && (
            <section>
              <h2 className="font-display mb-3 text-base font-semibold text-ink">
                Evidence
              </h2>
              <EvidenceGallery
                evidence={complaint.evidence}
                officerLabel={officers.label}
              />
            </section>
          )}

          {complaint.status === "REOPENED" && (
            <section className="border-status-reopened/30 bg-status-reopened-subtle rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <Gavel className="text-status-reopened size-5" aria-hidden="true" />
                <h2 className="font-display text-base font-semibold text-ink">
                  Rule on this dispute
                </h2>
              </div>
              <p className="text-ink-muted mt-1 text-sm">
                The citizen disputed the resolution. Uphold to send it back to the officer
                as In Progress, or reject to keep the original resolution and close it.
                Neither outcome credits points.
              </p>
              {disputeError && (
                <p
                  role="alert"
                  className="bg-status-rejected-subtle text-status-rejected mt-3 rounded-md px-3 py-2 text-sm"
                >
                  {disputeError}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={verdict === "UPHELD" ? "primary" : "outline"}
                  onClick={() => setVerdict("UPHELD")}
                >
                  Uphold dispute
                </Button>
                <Button
                  size="sm"
                  variant={verdict === "REJECTED" ? "danger" : "outline"}
                  onClick={() => setVerdict("REJECTED")}
                >
                  Reject dispute
                </Button>
              </div>
              <div className="mt-3">
                <Label htmlFor="dispute-review-reason" required>
                  Reason
                </Label>
                <Textarea
                  id="dispute-review-reason"
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  placeholder="Your justification, recorded on the status history."
                />
              </div>
              <Button
                size="sm"
                className="mt-3"
                disabled={!verdict}
                loading={reviewDispute.isPending}
                onClick={requestDisputeConfirmation}
              >
                Submit ruling
              </Button>
            </section>
          )}

          <section className="rounded-lg border border-line bg-surface p-4">
            <div className="flex items-center gap-2">
              <Sliders className="text-brand size-5" aria-hidden="true" />
              <h2 className="font-display text-base font-semibold text-ink">Override</h2>
            </div>
            <p className="text-ink-muted mt-1 text-sm">
              Correct the category, force a status, or reassign the zone. Every change
              here is recorded in the status history with you as the actor.
            </p>
            {overrideError && (
              <p
                role="alert"
                className="bg-status-rejected-subtle text-status-rejected mt-3 rounded-md px-3 py-2 text-sm"
              >
                {overrideError}
              </p>
            )}
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="override-status">Status</Label>
                <Combobox
                  id="override-status"
                  value={status}
                  onChange={(v) => setStatus(v as ComplaintStatus | "")}
                  options={[
                    { value: "", label: "No change" },
                    ...ALL_STATUSES.map((s) => ({ value: s, label: humanizeStatus(s) })),
                  ]}
                />
              </div>
              <div>
                <Label htmlFor="override-category">Category</Label>
                <Combobox
                  id="override-category"
                  value={categoryId}
                  onChange={setCategoryId}
                  options={[
                    { value: "", label: "No change" },
                    ...(categories?.map((c) => ({ value: c.id, label: c.name })) ?? []),
                  ]}
                />
              </div>
              <div>
                <Label htmlFor="override-zone">Zone</Label>
                <Combobox
                  id="override-zone"
                  value={zoneId}
                  onChange={setZoneId}
                  options={[
                    { value: "", label: "No change" },
                    ...(zones?.map((z) => ({ value: z.id, label: z.name })) ?? []),
                  ]}
                />
              </div>
            </div>
            {willBackfillSla && (
              <p className="text-ink-faint mt-3 text-xs">
                The SLA timer hasn't started on this complaint yet — forcing it to{" "}
                {humanizeStatus(status as ComplaintStatus)} will backfill the timer to
                start now, using the category's current SLA target.
              </p>
            )}
            <div className="mt-3">
              <Label htmlFor="override-reason">Reason (recommended)</Label>
              <Textarea
                id="override-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this override being made?"
              />
            </div>
            <Button
              size="sm"
              className="mt-3"
              disabled={!hasOverrideChanges}
              loading={override.isPending}
              onClick={requestOverrideConfirmation}
            >
              Apply override
            </Button>
          </section>
        </div>

        <aside className="order-first lg:order-none lg:sticky lg:top-6 lg:self-start">
          <TimelineSidebar
            statusHistory={complaint.statusHistory}
            progressNotes={complaint.progressNotes}
            viewerRole="ADMIN"
            officerLabel={officers.label}
          />
        </aside>
      </div>

      <Modal
        open={overrideConfirmOpen}
        onClose={() => setOverrideConfirmOpen(false)}
        title="Confirm override"
        description="This is recorded in the status history with you as the actor and can't be undone from here."
        footer={
          <>
            <Button variant="outline" onClick={() => setOverrideConfirmOpen(false)}>
              Cancel
            </Button>
            <Button loading={override.isPending} onClick={handleOverride}>
              Apply override
            </Button>
          </>
        }
      >
        <ul className="text-ink-muted space-y-1 text-sm">
          {status && (
            <li>
              Status →{" "}
              <span className="font-medium text-ink">{humanizeStatus(status)}</span>
            </li>
          )}
          {categoryId && (
            <li>
              Category →{" "}
              <span className="font-medium text-ink">
                {categories?.find((c) => c.id === categoryId)?.name ?? categoryId}
              </span>
            </li>
          )}
          {zoneId && (
            <li>
              Zone →{" "}
              <span className="font-medium text-ink">
                {zones?.find((z) => z.id === zoneId)?.name ?? zoneId}
              </span>
            </li>
          )}
          {reason.trim() && <li>Reason: &ldquo;{reason.trim()}&rdquo;</li>}
        </ul>
      </Modal>

      <Modal
        open={disputeConfirmOpen}
        onClose={() => setDisputeConfirmOpen(false)}
        title="Confirm dispute ruling"
        description="Neither outcome credits points, and this can't be undone from here."
        footer={
          <>
            <Button variant="outline" onClick={() => setDisputeConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={verdict === "REJECTED" ? "danger" : "primary"}
              loading={reviewDispute.isPending}
              onClick={handleDisputeReview}
            >
              Submit ruling
            </Button>
          </>
        }
      >
        <p className="text-ink-muted text-sm">
          {verdict === "UPHELD"
            ? "The dispute will be upheld — this complaint goes back to the officer as In Progress."
            : "The dispute will be rejected — the original resolution stands and the complaint is closed."}
        </p>
        {disputeReason.trim() && (
          <p className="text-ink-muted mt-2 text-sm">
            Reason: &ldquo;{disputeReason.trim()}&rdquo;
          </p>
        )}
      </Modal>
    </div>
  );
}
