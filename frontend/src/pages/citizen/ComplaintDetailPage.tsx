import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileQuestion, ThumbsDown, ThumbsUp, UserCog } from "lucide-react";
import { StatusPill, SeverityPill, SlaPill } from "@/components/ui/pills";
import { Button } from "@/components/ui/Button";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { Textarea } from "@/components/ui/Textarea";
import { Label } from "@/components/ui/Label";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { DynamicIcon } from "@/components/DynamicIcon";
import { EvidenceGallery } from "@/components/complaint/EvidenceGallery";
import { TimelineSidebar } from "@/components/complaint/TimelineSidebar";
import { useComplaint } from "@/hooks/useComplaint";
import { useOfficerStats } from "@/hooks/useOfficerStats";
import { useSubmitEvidence } from "@/hooks/useSubmitEvidence";
import { useConfirmResolution } from "@/hooks/useConfirmResolution";
import { useDisputeResolution } from "@/hooks/useDisputeResolution";
import { iconForCategory } from "@/lib/categoryIcons";
import { relativeTime } from "@/lib/datetime";
import { ApiRequestError } from "@/services/http";

export function ComplaintDetailPage() {
  const { complaintId } = useParams<{ complaintId: string }>();
  const { toast } = useToast();
  const { data: complaint, isLoading, isError } = useComplaint(complaintId);
  const { data: officerStats } = useOfficerStats(complaint?.assignedOfficerId);

  const submitEvidence = useSubmitEvidence(complaintId ?? "");
  const confirmResolution = useConfirmResolution(complaintId ?? "");
  const disputeResolution = useDisputeResolution(complaintId ?? "");

  const [resubmitPhoto, setResubmitPhoto] = useState<File | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputePhoto, setDisputePhoto] = useState<File | null>(null);
  const [disputeError, setDisputeError] = useState<string | null>(null);

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
      setDisputePhoto(null);
    } catch (error) {
      setDisputeError(
        error instanceof ApiRequestError
          ? error.message
          : "Something went wrong. Please try again.",
      );
    }
  }

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
            <h1 className="font-display text-xl font-semibold text-ink">
              {complaint.category.name}
            </h1>
            <p className="text-ink-faint font-mono text-xs">
              {complaint.id} · filed {relativeTime(complaint.createdAt)}
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
          {complaint.assignedOfficerId && (
            <div className="text-ink-muted flex items-center gap-2 rounded-md border border-line bg-surface p-3 text-sm">
              <UserCog className="size-4 shrink-0" aria-hidden="true" />
              Assigned to Officer #{complaint.assignedOfficerId}
              {officerStats && ` · ${officerStats.totalResolved} complaints resolved`}
            </div>
          )}

          {complaint.description && (
            <p className="text-ink-muted text-sm leading-relaxed">
              {complaint.description}
            </p>
          )}

          {complaint.evidence && complaint.evidence.length > 0 && (
            <section>
              <h2 className="font-display mb-3 text-base font-semibold text-ink">
                Evidence
              </h2>
              <EvidenceGallery evidence={complaint.evidence} />
            </section>
          )}

          {complaint.status === "NEEDS_MORE_EVIDENCE" && (
            <section className="rounded-lg border border-status-needs_more_evidence/30 bg-status-needs_more_evidence-subtle p-4">
              <h2 className="font-display text-base font-semibold text-ink">
                A clearer photo is needed
              </h2>
              <p className="text-ink-muted mt-1 text-sm">
                The officer reviewing this complaint asked for better evidence before
                proceeding.
              </p>
              <div className="mt-3 max-w-sm">
                <FileDropzone
                  files={resubmitPhoto ? [resubmitPhoto] : []}
                  onFilesChange={(files) => setResubmitPhoto(files[0] ?? null)}
                />
              </div>
              <Button
                size="sm"
                className="mt-3"
                disabled={!resubmitPhoto}
                loading={submitEvidence.isPending}
                onClick={handleResubmit}
              >
                Resubmit evidence
              </Button>
            </section>
          )}

          {complaint.status === "RESOLVED" && (
            <section className="rounded-lg border border-line bg-surface p-4">
              <h2 className="font-display text-base font-semibold text-ink">
                Is this actually fixed?
              </h2>
              <p className="text-ink-muted mt-1 text-sm">
                The officer marked this as resolved. Confirm it, or dispute it if the issue
                is still there.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button
                  size="sm"
                  loading={confirmResolution.isPending}
                  onClick={handleConfirm}
                >
                  <ThumbsUp className="size-4" aria-hidden="true" />
                  Confirm the fix
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDisputeOpen(true)}>
                  <ThumbsDown className="size-4" aria-hidden="true" />
                  It's not actually fixed
                </Button>
              </div>
            </section>
          )}
        </div>

        <aside className="order-first lg:order-none lg:sticky lg:top-6 lg:self-start">
          <TimelineSidebar
            statusHistory={complaint.statusHistory}
            progressNotes={complaint.progressNotes}
            notesTitle="Officer notes"
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
