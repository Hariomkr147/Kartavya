import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Label } from "@/components/ui/Label";
import { Textarea } from "@/components/ui/Textarea";
import { StatusPill } from "@/components/ui/pills";
import { useBatchUpdateStatus } from "@/hooks/useBatchUpdateStatus";
import { ApiRequestError } from "@/services/http";
import type { BatchStatusUpdateResult, ComplaintStatus, OfficerTargetStatus } from "@/types/api";

const STATUS_OPTIONS: { value: OfficerTargetStatus; label: string }[] = [
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "UNDER_RESOLUTION", label: "Under Resolution" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "NEEDS_MORE_EVIDENCE", label: "Needs More Evidence (recall)" },
  { value: "UNRESOLVABLE", label: "Unresolvable" },
];

const REASON_REQUIRED = new Set<OfficerTargetStatus>([
  "UNRESOLVABLE",
  "NEEDS_MORE_EVIDENCE",
]);

/**
 * Legal current-status set for each officer-triggerable target — mirrors
 * `OFFICER_TRANSITIONS` in the contract (openapi.yaml / schema.dbml). Every
 * item outside this set fails its batch entry with INVALID_TRANSITION, so
 * the confirmation copy needs it to avoid promising a count the request
 * can't actually deliver.
 */
const LEGAL_SOURCE_STATUSES: Record<OfficerTargetStatus, ComplaintStatus[]> = {
  IN_PROGRESS: ["UNDER_REVIEW"],
  UNDER_RESOLUTION: ["IN_PROGRESS"],
  RESOLVED: ["UNDER_RESOLUTION"],
  UNRESOLVABLE: ["UNDER_REVIEW", "IN_PROGRESS", "UNDER_RESOLUTION"],
  NEEDS_MORE_EVIDENCE: ["UNDER_REVIEW"],
};

export type BatchStatusTarget =
  { type: "ids"; complaintIds: string[] } | { type: "cluster"; clusterId: string };

export interface BatchStatusModalProps {
  open: boolean;
  onClose: () => void;
  target: BatchStatusTarget;
  /** Current status of every complaint this batch would touch, in order to size the confirmation copy honestly. */
  statuses: ComplaintStatus[];
}

export function BatchStatusModal({
  open,
  onClose,
  target,
  statuses,
}: BatchStatusModalProps) {
  const batch = useBatchUpdateStatus();
  const [status, setStatus] = useState<OfficerTargetStatus | "">("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<BatchStatusUpdateResult | null>(null);

  // Reset the form each time the modal opens. Adjusting state during render
  // (rather than in an effect) is the React-endorsed way to react to a prop
  // change like this — it re-renders before the browser paints instead of
  // triggering a second, effect-driven render pass.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStatus("");
      setReason("");
      setNote("");
      setFormError(null);
      setResult(null);
    }
  }

  const total = statuses.length;
  const eligibleCount = status
    ? statuses.filter((s) => LEGAL_SOURCE_STATUSES[status].includes(s)).length
    : total;

  async function handleApply() {
    setFormError(null);
    if (!status) {
      setFormError("Choose a target status.");
      return;
    }
    if (REASON_REQUIRED.has(status) && !reason.trim()) {
      setFormError("A reason is required for this status.");
      return;
    }
    try {
      const response = await batch.mutateAsync({
        ...(target.type === "ids"
          ? { complaintIds: target.complaintIds }
          : { clusterId: target.clusterId }),
        status,
        reason: reason.trim() || undefined,
        note: note.trim() || undefined,
      });
      setResult(response);
    } catch (error) {
      setFormError(
        error instanceof ApiRequestError
          ? error.message
          : "Something went wrong. Please try again.",
      );
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={result ? "Batch update results" : "Batch update status"}
      description={
        result
          ? undefined
          : status
            ? eligibleCount === total
              ? `Apply the same status change to ${eligibleCount} complaint${eligibleCount === 1 ? "" : "s"}.`
              : `${eligibleCount} of ${total} complaint${total === 1 ? "" : "s"} can move to this status — the rest aren't in a status this change applies to and will be skipped.`
            : `Choose a target status for up to ${total} complaint${total === 1 ? "" : "s"}. Only complaints eligible for that status will actually change.`
      }
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={batch.isPending}
              disabled={!!status && eligibleCount === 0}
              onClick={handleApply}
            >
              {status
                ? `Apply to ${eligibleCount} complaint${eligibleCount === 1 ? "" : "s"}`
                : "Apply"}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <p className="text-ink-muted text-sm">
            {result.summary.succeeded} of {result.summary.requested} succeeded
            {result.summary.failed > 0 && ` · ${result.summary.failed} failed`}.
          </p>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto">
            {result.results.map((item) => (
              <li
                key={item.complaintId}
                className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm"
              >
                <span className="font-mono text-xs text-ink">{item.complaintId}</span>
                {item.success ? (
                  <span className="text-status-resolved flex items-center gap-1.5">
                    <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                    {item.status && <StatusPill status={item.status} />}
                  </span>
                ) : (
                  <span
                    className="text-status-rejected flex items-center gap-1.5 text-right text-xs"
                    title={item.errorMessage ?? undefined}
                  >
                    <XCircle className="size-4 shrink-0" aria-hidden="true" />
                    {item.errorCode}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          {formError && (
            <p
              role="alert"
              className="bg-status-rejected-subtle text-status-rejected rounded-md px-3 py-2 text-sm"
            >
              {formError}
            </p>
          )}
          <div>
            <Label htmlFor="batch-status" required>
              Target status
            </Label>
            <Combobox
              id="batch-status"
              value={status}
              onChange={(v) => setStatus(v as OfficerTargetStatus)}
              placeholderDisabled
              options={[{ value: "", label: "Select a status…" }, ...STATUS_OPTIONS]}
            />
          </div>
          {status && REASON_REQUIRED.has(status) && (
            <div>
              <Label htmlFor="batch-reason" required>
                Reason
              </Label>
              <Textarea
                id="batch-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this batch moving to this status?"
              />
            </div>
          )}
          {status === "RESOLVED" && (
            <div>
              <Label htmlFor="batch-note">Closing note (optional)</Label>
              <Textarea
                id="batch-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Applied to every complaint in this batch."
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
