import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUp,
  Boxes,
  Check,
  CheckCircle2,
  Copy,
  FileQuestion,
  Gauge,
  Info,
  ShieldAlert,
  UserCog,
  XCircle,
} from "lucide-react";
import { StatusPill, SeverityPill, SlaPill } from "@/components/ui/pills";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { Label } from "@/components/ui/Label";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tooltip } from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import { DynamicIcon } from "@/components/DynamicIcon";
import { EvidenceGallery } from "@/components/complaint/EvidenceGallery";
import { TimelineSidebar } from "@/components/complaint/TimelineSidebar";
import { MiniMap, type MiniMapPin } from "@/components/ui/MiniMap";
import { useAuth } from "@/contexts/AuthContext";
import { useComplaint } from "@/hooks/useComplaint";
import { useCluster } from "@/hooks/useCluster";
import { useClaimComplaint } from "@/hooks/useClaimComplaint";
import { useReviewEvidence } from "@/hooks/useReviewEvidence";
import { useUpdateComplaintStatus } from "@/hooks/useUpdateComplaintStatus";
import { useAddProgressNote } from "@/hooks/useAddProgressNote";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime, absoluteDateTime } from "@/lib/datetime";
import { ApiRequestError } from "@/services/http";
import type { TranslationKey } from "@/i18n";
import type {
  EvidenceVerdict,
  OfficerTargetStatus,
  StatusUpdateResult,
} from "@/types/api";
import { RefreshButton } from "@/components/ui/RefreshButton";

type ActionModalType = "resolve" | "recall" | "unresolvable";

const ACTION_MODAL_CONFIG: Record<
  ActionModalType,
  {
    titleKey: TranslationKey;
    descriptionKey: TranslationKey;
    targetStatus: OfficerTargetStatus;
    reasonRequired: boolean;
    noteField: boolean;
    confirmLabelKey: TranslationKey;
  }
> = {
  resolve: {
    titleKey: "officerComplaint.actions.resolve.title",
    descriptionKey: "officerComplaint.actions.resolve.description",
    targetStatus: "RESOLVED",
    reasonRequired: false,
    noteField: true,
    confirmLabelKey: "officerComplaint.actions.resolve.confirm",
  },
  recall: {
    titleKey: "officerComplaint.actions.recall.title",
    descriptionKey: "officerComplaint.actions.recall.description",
    targetStatus: "NEEDS_MORE_EVIDENCE",
    reasonRequired: true,
    noteField: false,
    confirmLabelKey: "officerComplaint.actions.recall.confirm",
  },
  unresolvable: {
    titleKey: "officerComplaint.actions.unresolvable.title",
    descriptionKey: "officerComplaint.actions.unresolvable.description",
    targetStatus: "UNRESOLVABLE",
    reasonRequired: true,
    noteField: false,
    confirmLabelKey: "officerComplaint.actions.unresolvable.confirm",
  },
};

export function OfficerComplaintDetailPage() {
  const { t } = useTranslation();
  const { complaintId } = useParams<{ complaintId: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const {
    data: complaint,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useComplaint(complaintId);
  const { data: cluster } = useCluster(complaint?.clusterId);

  const claim = useClaimComplaint();
  const reviewEvidence = useReviewEvidence(complaintId ?? "");
  const updateStatus = useUpdateComplaintStatus(complaintId ?? "");
  const addNote = useAddProgressNote(complaintId ?? "");

  const [reviewVerdict, setReviewVerdict] = useState<EvidenceVerdict | "">("");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);

  const [actionModal, setActionModal] = useState<ActionModalType | null>(null);
  const [modalReason, setModalReason] = useState("");
  const [modalNote, setModalNote] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);

  const [cascade, setCascade] = useState<StatusUpdateResult["cascade"] | null>(null);
  const [noteText, setNoteText] = useState("");
  const [copied, setCopied] = useState(false);

  const { record: recordRecentlyViewed } = useRecentlyViewed(
    `officer:${user?.id ?? "anon"}`,
  );

  useEffect(() => {
    if (!complaint) return;
    recordRecentlyViewed({
      id: complaint.id,
      label: complaint.category.name,
      sublabel: complaint.id,
      href: `/officer/queue/${complaint.id}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complaint?.id]);

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
        title={t("complaintDetail.notFound")}
        description={t("officerComplaint.notFoundBody")}
        action={
          <Link
            to="/officer/queue"
            className="text-brand text-sm font-medium hover:underline"
          >
            Back to Queue
          </Link>
        }
        className="mx-auto max-w-md py-24"
      />
    );
  }

  const latestEvidence = complaint.evidence?.length
    ? [...complaint.evidence].sort((a, b) => b.sequence - a.sequence)[0]
    : null;
  const needsEvidenceReview =
    complaint.status === "EVIDENCE_UNDER_REVIEW" &&
    latestEvidence != null &&
    latestEvidence.verdict == null;
  // REJECTED is only legal before the complaint has ever reached UNDER_REVIEW
  // — once slaTargetHours is set (on first acceptance), only VALID or
  // NEEDS_MORE_EVIDENCE remain (see openapi.yaml's evidence-review notes).
  const canReject = complaint.slaTargetHours == null;

  const mapPins: MiniMapPin[] = [];
  if (complaint.latitude != null && complaint.longitude != null) {
    mapPins.push({
      id: complaint.id,
      lat: complaint.latitude,
      lng: complaint.longitude,
      label: t("officerComplaint.thisComplaint"),
    });
  }
  if (cluster) {
    mapPins.push({
      id: `cluster-${cluster.id}`,
      lat: cluster.centroidLat,
      lng: cluster.centroidLng,
      label: t("officerComplaint.clusterCentroid"),
    });
  }

  async function handleCopyId() {
    try {
      await navigator.clipboard.writeText(complaint!.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: t("complaintDetail.idCopyFailed"), variant: "error" });
    }
  }

  async function runStatusUpdate(
    status: OfficerTargetStatus,
    opts?: { reason?: string; note?: string },
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const result = await updateStatus.mutateAsync({ status, ...opts });
      setCascade(result.cascade ?? null);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof ApiRequestError ? error.message : t("errors.generic"),
      };
    }
  }

  async function handleClaim() {
    if (!complaintId) return;
    try {
      await claim.mutateAsync(complaintId);
      toast({
        title: t("officerQueue.claimed"),
        description: t("officerComplaint.claimedBody"),
        variant: "success",
      });
    } catch (error) {
      toast({
        title: t("officerQueue.claimFailed"),
        description: error instanceof ApiRequestError ? error.message : undefined,
        variant: "error",
      });
    }
  }

  async function handleReviewSubmit() {
    setReviewError(null);
    if (!reviewVerdict) {
      setReviewError(t("officerComplaint.chooseVerdict"));
      return;
    }
    if (
      (reviewVerdict === "NEEDS_MORE_EVIDENCE" || reviewVerdict === "REJECTED") &&
      !reviewReason.trim()
    ) {
      setReviewError(t("officerComplaint.verdictReasonRequired"));
      return;
    }
    try {
      await reviewEvidence.mutateAsync({
        verdict: reviewVerdict,
        reason: reviewReason.trim() || undefined,
      });
      toast({ title: t("officerComplaint.verdictRecorded"), variant: "success" });
      setReviewVerdict("");
      setReviewReason("");
    } catch (error) {
      setReviewError(
        error instanceof ApiRequestError ? error.message : t("errors.generic"),
      );
    }
  }

  async function handleSimpleTransition(
    status: OfficerTargetStatus,
    successTitle: string,
  ) {
    const result = await runStatusUpdate(status);
    if (result.ok) toast({ title: successTitle, variant: "success" });
    else
      toast({
        title: t("officerComplaint.statusUpdateFailed"),
        description: result.message,
        variant: "error",
      });
  }

  function openActionModal(type: ActionModalType) {
    setActionModal(type);
    setModalReason("");
    setModalNote("");
    setModalError(null);
  }

  async function handleModalConfirm() {
    if (!actionModal) return;
    setModalError(null);
    const config = ACTION_MODAL_CONFIG[actionModal];
    if (config.reasonRequired && !modalReason.trim()) {
      setModalError(t("officerComplaint.reasonRequired"));
      return;
    }
    const result = await runStatusUpdate(config.targetStatus, {
      reason: modalReason.trim() || undefined,
      note: modalNote.trim() || undefined,
    });
    if (result.ok) {
      toast({ title: t(config.titleKey), variant: "success" });
      setActionModal(null);
    } else {
      setModalError(result.message);
    }
  }

  async function handleAddNote() {
    if (!noteText.trim()) return;
    try {
      await addNote.mutateAsync(noteText.trim());
      toast({ title: t("clusterDetail.notePosted"), variant: "success" });
      setNoteText("");
    } catch (error) {
      toast({
        title: t("officerComplaint.notePostFailed"),
        description: error instanceof ApiRequestError ? error.message : undefined,
        variant: "error",
      });
    }
  }

  const assignedLabel =
    complaint.assignedOfficerId == null
      ? t("officerQueue.tabs.unassigned")
      : complaint.assignedOfficerId === user?.id
        ? t("statusTimeline.you")
        : t("statusTimeline.officer", { officerId: complaint.assignedOfficerId });

  const canAddNote =
    complaint.status === "IN_PROGRESS" || complaint.status === "UNDER_RESOLUTION";
  const modalConfig = actionModal ? ACTION_MODAL_CONFIG[actionModal] : null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-12">
      <Link
        to="/officer/queue"
        className="text-ink-muted inline-flex items-center gap-1.5 text-sm hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("nav.queue")}
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
            <div className="text-ink-faint flex items-center gap-1.5 font-mono text-xs">
              {t("complaintDetail.filedLine", {
                complaintId: complaint.id,
                when: relativeTime(complaint.createdAt),
              })}
              <button
                type="button"
                onClick={handleCopyId}
                aria-label={t("complaintDetail.copyId")}
                className="text-ink-faint hover:text-ink inline-flex items-center"
              >
                {copied ? (
                  <Check className="text-status-resolved size-3.5" aria-hidden="true" />
                ) : (
                  <Copy className="size-3.5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={complaint.status} />
          {complaint.severityLabel && <SeverityPill severity={complaint.severityLabel} />}
          {complaint.slaLabel && <SlaPill sla={complaint.slaLabel} />}
        </div>
      </div>

      <div className="text-ink-muted flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <ArrowUp className="text-ink-faint size-4" aria-hidden="true" />
          {t("officerComplaint.upvotes", { count: complaint.upvoteCount ?? 0 })}
        </span>
        {complaint.severityScore != null && (
          <span className="inline-flex items-center gap-1.5">
            <Gauge className="text-ink-faint size-4" aria-hidden="true" />
            {t("officerComplaint.severityScore", { score: complaint.severityScore })}
            <Tooltip
              side="bottom"
              content={
                <span className="block max-w-xs text-left">
                  {cluster
                    ? t("officerComplaint.severityWithCluster", {
                        score: complaint.severityScore,
                        reporters: cluster.uniqueReporterCount,
                        upvotes: complaint.upvoteCount ?? 0,
                      })
                    : t("complaintDetail.severityNoCluster", {
                        score: complaint.severityScore,
                        upvotes: complaint.upvoteCount ?? 0,
                      })}
                </span>
              }
            >
              <button
                type="button"
                aria-label={t("complaintDetail.severityHelp")}
                className="text-ink-faint hover:text-ink"
              >
                <Info className="size-3.5" aria-hidden="true" />
              </button>
            </Tooltip>
          </span>
        )}
        {complaint.updatedAt && (
          <span title={absoluteDateTime(complaint.updatedAt)}>
            {t("officerComplaint.lastUpdated", {
              when: relativeTime(complaint.updatedAt),
            })}
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <div className="text-ink-muted flex items-center gap-2 rounded-md border border-line bg-surface p-3 text-sm">
            <UserCog className="size-4 shrink-0" aria-hidden="true" />
            {t("officerComplaint.assigned", { assignee: assignedLabel })}
          </div>

          {mapPins.length > 0 && (
            <section>
              <h2 className="font-display mb-3 text-base font-semibold text-ink">
                {t("fileComplaint.location")}
              </h2>
              <MiniMap pins={mapPins} height={220} />
            </section>
          )}

          {cluster && (
            <Link
              to={`/officer/clusters/${cluster.id}`}
              className="border-brand/30 bg-brand/5 hover:bg-brand/10 flex items-center gap-2 rounded-md border p-3 text-sm text-ink transition-colors"
            >
              <Boxes className="text-brand size-4 shrink-0" aria-hidden="true" />
              {t("officerComplaint.clusterBanner", {
                reports: cluster.reportCount,
                reporters: cluster.uniqueReporterCount,
              })}
            </Link>
          )}

          {complaint.description && (
            <p className="text-ink-muted text-sm leading-relaxed">
              {complaint.description}
            </p>
          )}

          {cascade && cascade.length > 0 && (
            <section className="rounded-lg border border-status-resolved/30 bg-status-resolved-subtle p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-display flex items-center gap-2 text-base font-semibold text-ink">
                  <CheckCircle2
                    className="text-status-resolved size-5"
                    aria-hidden="true"
                  />
                  {t("officerComplaint.cascade")}
                </p>
                <button
                  type="button"
                  onClick={() => setCascade(null)}
                  className="text-ink-faint hover:text-ink text-xs"
                >
                  {t("common.dismiss")}
                </button>
              </div>
              <ul className="space-y-1 text-sm">
                {cascade.map((item) => (
                  <li key={item.complaintId} className="flex items-center gap-2">
                    {item.outcome === "CASCADED" ? (
                      <CheckCircle2
                        className="text-status-resolved size-4 shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <XCircle
                        className="text-ink-faint size-4 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span className="text-ink-muted">
                      {item.complaintId} —{" "}
                      {item.outcome === "CASCADED"
                        ? t("officerComplaint.cascadeMoved")
                        : t("officerComplaint.cascadeLeft", {
                            status: t(`status.${item.previousStatus}`),
                          })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {complaint.status === "SUBMITTED" && (
            <section className="rounded-lg border border-line bg-surface p-4">
              <h2 className="font-display text-base font-semibold text-ink">
                {t("officerComplaint.pickUp")}
              </h2>
              <p className="text-ink-muted mt-1 text-sm">
                {t("officerComplaint.pickUpBody")}
              </p>
              <Button
                size="sm"
                className="mt-3"
                loading={claim.isPending}
                onClick={handleClaim}
              >
                {t("officerQueue.claim")}
              </Button>
            </section>
          )}

          {complaint.evidence && complaint.evidence.length > 0 && (
            <section>
              <h2 className="font-display mb-3 text-base font-semibold text-ink">
                {t("complaintDetail.evidence")}
              </h2>
              <EvidenceGallery evidence={complaint.evidence} />
            </section>
          )}

          {needsEvidenceReview && (
            <section className="border-brand/30 bg-brand/5 rounded-lg border p-4">
              <h2 className="font-display text-base font-semibold text-ink">
                {t("officerComplaint.reviewPhoto")}
              </h2>
              <p className="text-ink-muted mt-1 text-sm">
                {t("officerComplaint.reviewPhotoBody")}
              </p>
              {reviewError && (
                <p
                  role="alert"
                  className="bg-status-rejected-subtle text-status-rejected mt-3 rounded-md px-3 py-2 text-sm"
                >
                  {reviewError}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={reviewVerdict === "VALID" ? "primary" : "outline"}
                  onClick={() => setReviewVerdict("VALID")}
                >
                  {t("officerComplaint.valid")}
                </Button>
                <Button
                  size="sm"
                  variant={
                    reviewVerdict === "NEEDS_MORE_EVIDENCE" ? "primary" : "outline"
                  }
                  onClick={() => setReviewVerdict("NEEDS_MORE_EVIDENCE")}
                >
                  {t("status.NEEDS_MORE_EVIDENCE")}
                </Button>
                {canReject && (
                  <Button
                    size="sm"
                    variant={reviewVerdict === "REJECTED" ? "danger" : "outline"}
                    onClick={() => setReviewVerdict("REJECTED")}
                  >
                    {t("officerComplaint.reject")}
                  </Button>
                )}
              </div>
              {(reviewVerdict === "NEEDS_MORE_EVIDENCE" ||
                reviewVerdict === "REJECTED") && (
                <div className="mt-3">
                  <Label htmlFor="review-reason" required>
                    {t("common.reason")}
                  </Label>
                  <Textarea
                    id="review-reason"
                    value={reviewReason}
                    onChange={(e) => setReviewReason(e.target.value)}
                    placeholder={t("officerComplaint.whyPlaceholder")}
                  />
                </div>
              )}
              <Button
                size="sm"
                className="mt-3"
                disabled={!reviewVerdict}
                loading={reviewEvidence.isPending}
                onClick={handleReviewSubmit}
              >
                {t("officerComplaint.submitVerdict")}
              </Button>
            </section>
          )}

          {complaint.status === "REOPENED" && (
            <div className="text-ink-muted flex items-center gap-2 rounded-md border border-status-reopened/30 bg-status-reopened-subtle p-3 text-sm">
              <ShieldAlert
                className="text-status-reopened size-4 shrink-0"
                aria-hidden="true"
              />
              {t("officerComplaint.reopenedNotice")}
            </div>
          )}

          {(complaint.status === "UNDER_REVIEW" ||
            complaint.status === "IN_PROGRESS" ||
            complaint.status === "UNDER_RESOLUTION") && (
            <section className="rounded-lg border border-line bg-surface p-4">
              <h2 className="font-display text-base font-semibold text-ink">
                {t("officerComplaint.moveComplaint")}
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {complaint.status === "UNDER_REVIEW" && (
                  <>
                    <Button
                      size="sm"
                      onClick={() =>
                        handleSimpleTransition(
                          "IN_PROGRESS",
                          t("officerComplaint.movedToInProgress"),
                        )
                      }
                    >
                      {t("officerComplaint.startWork")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openActionModal("recall")}
                    >
                      {t("officerComplaint.actions.recall.title")}
                    </Button>
                  </>
                )}
                {complaint.status === "IN_PROGRESS" && (
                  <Button
                    size="sm"
                    onClick={() =>
                      handleSimpleTransition(
                        "UNDER_RESOLUTION",
                        t("officerComplaint.movedToUnderResolution"),
                      )
                    }
                  >
                    {t("officerComplaint.moveToUnderResolution")}
                  </Button>
                )}
                {complaint.status === "UNDER_RESOLUTION" && (
                  <Button size="sm" onClick={() => openActionModal("resolve")}>
                    {t("officerComplaint.actions.resolve.title")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => openActionModal("unresolvable")}
                >
                  {t("officerComplaint.actions.unresolvable.title")}
                </Button>
              </div>
            </section>
          )}

          {canAddNote && (
            <section className="rounded-lg border border-line bg-surface p-4">
              <h2 className="font-display text-base font-semibold text-ink">
                {t("officerComplaint.postNote")}
              </h2>
              <p className="text-ink-muted mt-1 text-sm">
                {t("officerComplaint.postNoteBody")}
              </p>
              <div className="mt-3">
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder={t("clusterDetail.notePlaceholder")}
                  maxLength={500}
                />
              </div>
              <Button
                size="sm"
                className="mt-2"
                disabled={!noteText.trim()}
                loading={addNote.isPending}
                onClick={handleAddNote}
              >
                {t("clusterDetail.postNote")}
              </Button>
            </section>
          )}
        </div>

        <aside className="order-first lg:order-none lg:sticky lg:top-6 lg:self-start">
          <TimelineSidebar
            statusHistory={complaint.statusHistory}
            progressNotes={complaint.progressNotes}
            viewerRole="OFFICER"
            viewerOfficerId={user?.id}
            slaTargetHours={complaint.slaTargetHours}
          />
        </aside>
      </div>

      <Modal
        open={actionModal !== null}
        onClose={() => setActionModal(null)}
        title={modalConfig ? t(modalConfig.titleKey) : undefined}
        description={modalConfig ? t(modalConfig.descriptionKey) : undefined}
        footer={
          <>
            <Button variant="outline" onClick={() => setActionModal(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant={actionModal === "unresolvable" ? "danger" : "primary"}
              loading={updateStatus.isPending}
              onClick={handleModalConfirm}
            >
              {modalConfig ? t(modalConfig.confirmLabelKey) : null}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && (
            <p
              role="alert"
              className="bg-status-rejected-subtle text-status-rejected rounded-md px-3 py-2 text-sm"
            >
              {modalError}
            </p>
          )}
          {modalConfig?.reasonRequired && (
            <div>
              <Label htmlFor="action-reason" required>
                {t("common.reason")}
              </Label>
              <Textarea
                id="action-reason"
                value={modalReason}
                onChange={(e) => setModalReason(e.target.value)}
                placeholder={t("officerComplaint.explainWhy")}
              />
            </div>
          )}
          {modalConfig?.noteField && (
            <div>
              <Label htmlFor="action-note">{t("batch.closingNote")}</Label>
              <Textarea
                id="action-note"
                value={modalNote}
                onChange={(e) => setModalNote(e.target.value)}
                placeholder={t("officerComplaint.visibleToCitizen")}
              />
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
