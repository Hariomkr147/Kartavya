import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUp,
  Copy,
  FileQuestion,
  Info,
  MapPinned,
  Users,
  UserCog,
} from "lucide-react";
import { StatusPill, SeverityPill, SlaPill } from "@/components/ui/pills";
import { Button } from "@/components/ui/Button";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { Textarea } from "@/components/ui/Textarea";
import { Label } from "@/components/ui/Label";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tooltip } from "@/components/ui/Tooltip";
import { MiniMap } from "@/components/ui/MiniMap";
import { useToast } from "@/components/ui/Toast";
import { DynamicIcon } from "@/components/DynamicIcon";
import { EvidenceGallery } from "@/components/complaint/EvidenceGallery";
import { TimelineSidebar } from "@/components/complaint/TimelineSidebar";
import { LifecycleTracker } from "@/components/complaint/LifecycleTracker";
import { ActionRequiredPanel } from "@/components/complaint/ActionRequiredPanel";
import { useComplaint } from "@/hooks/useComplaint";
import { useOfficerStats } from "@/hooks/useOfficerStats";
import { useSubmitEvidence } from "@/hooks/useSubmitEvidence";
import { useConfirmResolution } from "@/hooks/useConfirmResolution";
import { useDisputeResolution } from "@/hooks/useDisputeResolution";
import { useLandmark } from "@/hooks/useLandmark";
import { useAuth } from "@/contexts/AuthContext";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { useLocalDraft } from "@/hooks/useLocalDraft";
import { iconForCategory } from "@/lib/categoryIcons";
import { otherReporterCount } from "@/lib/clusterInsight";
import { describeLifecycle } from "@/lib/lifecycle";
import { relativeTime } from "@/lib/datetime";
import { ApiRequestError } from "@/services/http";
import { RefreshButton } from "@/components/ui/RefreshButton";

/** Documented in the contract on `POST /complaints/{id}/upvote`. */
const CSP_PER_UPVOTE = 5;

export function ComplaintDetailPage() {
  const { complaintId } = useParams<{ complaintId: string }>();
  const { toast } = useToast();
  const { user } = useAuth();
  const {
    data: complaint,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useComplaint(complaintId);
  const { data: officerStats } = useOfficerStats(complaint?.assignedOfficerId);
  const { data: landmark } = useLandmark(complaint?.latitude, complaint?.longitude);
  const { record: recordRecentlyViewed } = useRecentlyViewed(
    `citizen:${user?.id ?? "anon"}`,
  );

  const submitEvidence = useSubmitEvidence(complaintId ?? "");
  const confirmResolution = useConfirmResolution(complaintId ?? "");
  const disputeResolution = useDisputeResolution(complaintId ?? "");

  const [resubmitPhoto, setResubmitPhoto] = useState<File | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [
    disputeReason,
    setDisputeReason,
    { hasDraft: hasDisputeDraft, clearDraft: clearDisputeDraft },
  ] = useLocalDraft(
    // Scoped per citizen, matching every other client-persisted key in this
    // app — a complaint's owner is the only one who can ever reach this
    // page (403 otherwise), so the practical exposure is low, but there's no
    // reason for this one key to be the exception.
    `dispute-reason:${user?.id ?? "anon"}:${complaintId ?? "unknown"}`,
    "",
  );
  const [disputePhoto, setDisputePhoto] = useState<File | null>(null);
  const [disputeError, setDisputeError] = useState<string | null>(null);
  // Resets only what should never survive a reopen. `disputeReason` is
  // deliberately excluded — it's the one field persisted via
  // `useLocalDraft`, precisely so closing the modal by accident doesn't lose
  // typed text — and `disputePhoto` is left alone too: within the same page
  // session (no reload) a citizen who closes and reopens the modal should
  // find their selected photo still there, the same way the reason does.
  const [wasDisputeOpen, setWasDisputeOpen] = useState(disputeOpen);
  if (disputeOpen !== wasDisputeOpen) {
    setWasDisputeOpen(disputeOpen);
    if (disputeOpen) setDisputeError(null);
  }

  useEffect(() => {
    if (!complaint) return;
    recordRecentlyViewed({
      id: complaint.id,
      label: complaint.category.name,
      sublabel: complaint.id,
      href: `/citizen/complaints/${complaint.id}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complaint?.id]);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !complaint) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Complaint not found"
        description="It may have been removed, or you don't have access to it."
        action={
          <Link
            to="/citizen/complaints"
            className="text-brand text-sm font-medium hover:underline"
          >
            Back to My Complaints
          </Link>
        }
        className="mx-auto max-w-md py-24"
      />
    );
  }

  async function handleResubmit() {
    if (!resubmitPhoto) return;
    try {
      await submitEvidence.mutateAsync(resubmitPhoto);
      toast({
        title: "Evidence resubmitted",
        description: "An officer will take another look.",
        variant: "success",
      });
      setResubmitPhoto(null);
    } catch (error) {
      toast({
        title: "Couldn't resubmit evidence",
        description: error instanceof ApiRequestError ? error.message : undefined,
        variant: "error",
      });
    }
  }

  async function handleConfirm() {
    try {
      await confirmResolution.mutateAsync();
      toast({
        title: "Thanks for confirming!",
        description: "This complaint is now closed.",
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Couldn't confirm",
        description: error instanceof ApiRequestError ? error.message : undefined,
        variant: "error",
      });
    }
  }

  async function handleDispute() {
    setDisputeError(null);
    if (!disputeReason.trim() || !disputePhoto) {
      setDisputeError("A reason and a fresh photo are both required.");
      return;
    }
    try {
      await disputeResolution.mutateAsync({
        reason: disputeReason.trim(),
        photo: disputePhoto,
      });
      toast({
        title: "Dispute filed",
        description: "An admin will review it.",
        variant: "success",
      });
      setDisputeOpen(false);
      setDisputeReason("");
      clearDisputeDraft();
      setDisputePhoto(null);
    } catch (error) {
      setDisputeError(
        error instanceof ApiRequestError
          ? error.message
          : "Something went wrong. Please try again.",
      );
    }
  }

  async function handleCopyId() {
    if (!complaint) return;
    try {
      await navigator.clipboard.writeText(complaint.id);
      toast({ title: "Complaint ID copied", variant: "success" });
    } catch {
      toast({ title: "Couldn't copy complaint ID", variant: "error" });
    }
  }

  const upvoteCount = complaint.upvoteCount ?? 0;
  // Recoverable from the contract's own severity formula — the cluster
  // endpoints themselves are officer/admin-scoped, so this is the only way a
  // citizen can be told how many neighbours hit the same problem.
  const otherReporters = complaint.clusterId
    ? otherReporterCount(complaint.severityScore, upvoteCount)
    : null;
  const showBackingCard = upvoteCount > 0 || !!complaint.clusterId;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-12">
      <Link
        to="/citizen/complaints"
        className="text-ink-muted inline-flex items-center gap-1.5 text-sm hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        My Complaints
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
            <p className="text-ink-faint flex items-center gap-1.5 font-mono text-xs">
              {complaint.id} · filed {relativeTime(complaint.createdAt)}
              <button
                type="button"
                onClick={handleCopyId}
                aria-label="Copy complaint ID"
                className="text-ink-faint hover:text-ink"
              >
                <Copy className="size-3.5" aria-hidden="true" />
              </button>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={complaint.status} />
          {complaint.severityLabel && (
            <span className="inline-flex items-center gap-1">
              <SeverityPill severity={complaint.severityLabel} />
              {complaint.severityScore != null && (
                <Tooltip
                  side="bottom"
                  content={
                    <span className="block max-w-xs text-left">
                      {complaint.clusterId
                        ? `Score ${complaint.severityScore} = (nearby reports − 1) × 3 + ${upvoteCount} upvote(s). This complaint is linked to nearby duplicate reports via its cluster.`
                        : `Score ${complaint.severityScore} = ${upvoteCount} upvote(s) — no nearby duplicates linked to this complaint.`}
                    </span>
                  }
                >
                  <button
                    type="button"
                    aria-label="How is the severity score calculated?"
                    className="text-ink-faint hover:text-ink"
                  >
                    <Info className="size-3.5" aria-hidden="true" />
                  </button>
                </Tooltip>
              )}
            </span>
          )}
          {complaint.slaLabel && (
            <SlaPill
              sla={complaint.slaLabel}
              past={describeLifecycle(complaint.status).isTerminal}
            />
          )}
        </div>
      </div>

      <LifecycleTracker status={complaint.status} />

      <ActionRequiredPanel
        complaint={complaint}
        resubmitPhoto={resubmitPhoto}
        onResubmitPhotoChange={setResubmitPhoto}
        onResubmit={handleResubmit}
        resubmitting={submitEvidence.isPending}
        onConfirm={handleConfirm}
        confirming={confirmResolution.isPending}
        onOpenDispute={() => setDisputeOpen(true)}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          {showBackingCard && (
            <section className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {upvoteCount > 0 && (
                  <p className="flex items-center gap-2 text-sm text-ink">
                    <span className="bg-brand-subtle text-brand inline-flex size-7 shrink-0 items-center justify-center rounded-full">
                      <ArrowUp className="size-4" aria-hidden="true" />
                    </span>
                    <span>
                      <span className="font-semibold">{upvoteCount}</span>{" "}
                      {upvoteCount === 1 ? "neighbour has" : "neighbours have"} backed this
                      report
                    </span>
                  </p>
                )}
                {upvoteCount > 0 && (
                  <span className="bg-csp/15 text-csp rounded-full px-2.5 py-0.5 text-xs font-semibold">
                    +{upvoteCount * CSP_PER_UPVOTE} CSP earned from upvotes
                  </span>
                )}
              </div>
              {complaint.clusterId && (
                <p className="text-ink-muted mt-3 flex items-start gap-2 text-sm">
                  <Users className="text-brand mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {otherReporters && otherReporters > 0 ? (
                    <span>
                      <span className="font-medium text-ink">
                        {otherReporters} other {otherReporters === 1 ? "person" : "people"}
                      </span>{" "}
                      reported this same issue nearby — the city treats them as one job,
                      so fixing it resolves all of them together.
                    </span>
                  ) : (
                    <span>
                      Reported by others nearby — this issue is linked to similar reports
                      in its cluster.
                    </span>
                  )}
                </p>
              )}
            </section>
          )}

          {complaint.assignedOfficerId && (
            <div className="text-ink-muted flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface p-3 text-sm">
              <UserCog className="size-4 shrink-0" aria-hidden="true" />
              <span>Assigned to Officer #{complaint.assignedOfficerId}</span>
              {officerStats && (
                <span className="bg-brand-subtle text-brand inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
                  {officerStats.totalResolved} cases resolved so far
                </span>
              )}
            </div>
          )}

          {complaint.description && (
            <section>
              <h2 className="font-display mb-3 text-base font-semibold text-ink">
                Description
              </h2>
              <p className="text-ink-muted text-sm leading-relaxed">
                {complaint.description}
              </p>
            </section>
          )}

          {complaint.latitude != null && complaint.longitude != null && (
            <section>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-base font-semibold text-ink">Location</h2>
                {landmark && (
                  <p className="text-ink-faint flex items-center gap-1.5 text-xs">
                    <MapPinned className="size-3.5 shrink-0" aria-hidden="true" />
                    {landmark}
                  </p>
                )}
              </div>
              <MiniMap
                pins={[
                  { id: complaint.id, lat: complaint.latitude, lng: complaint.longitude },
                ]}
              />
            </section>
          )}

          {complaint.evidence && complaint.evidence.length > 0 && (
            <section>
              <h2 className="font-display mb-3 text-base font-semibold text-ink">
                Evidence
              </h2>
              <EvidenceGallery evidence={complaint.evidence} />
            </section>
          )}
        </div>

        <aside className="order-first lg:order-none lg:sticky lg:top-6 lg:self-start">
          <TimelineSidebar
            statusHistory={complaint.statusHistory}
            progressNotes={complaint.progressNotes}
            slaTargetHours={complaint.slaTargetHours}
          />
        </aside>
      </div>

      <Modal
        open={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        title="Dispute this resolution"
        description="Explain why the issue isn't actually fixed, and attach a fresh photo as proof."
        footer={
          <>
            <Button variant="outline" onClick={() => setDisputeOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={disputeResolution.isPending}
              onClick={handleDispute}
            >
              Submit dispute
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {disputeError && (
            <p
              role="alert"
              className="bg-status-rejected-subtle text-status-rejected rounded-md px-3 py-2 text-sm"
            >
              {disputeError}
            </p>
          )}
          <p className="text-ink-muted text-sm">
            This sends the report to an administrator for a verdict. If they uphold it, an
            officer picks the work back up; if not, it closes here.
          </p>
          {hasDisputeDraft && !disputePhoto && (
            <p className="text-ink-muted bg-surface-hover rounded-md px-3 py-2 text-xs">
              We restored the reason you'd started typing earlier — a photo can't be saved
              the same way, so please attach a fresh one to finish.
            </p>
          )}
          <div>
            <Label htmlFor="dispute-reason" required>
              Reason
            </Label>
            <Textarea
              id="dispute-reason"
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
              placeholder="What's still wrong?"
            />
          </div>
          <div>
            <Label required>Fresh photo</Label>
            <FileDropzone
              files={disputePhoto ? [disputePhoto] : []}
              onFilesChange={(files) => setDisputePhoto(files[0] ?? null)}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
