import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Label } from "@/components/ui/Label";
import { Textarea } from "@/components/ui/Textarea";
import { StatusPill } from "@/components/ui/pills";
import { useBatchUpdateStatus } from "@/hooks/useBatchUpdateStatus";
import { ApiRequestError } from "@/services/http";
import type { BatchStatusUpdateResult, OfficerTargetStatus } from "@/types/api";

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

export type BatchStatusTarget =
  | { type: "ids"; complaintIds: string[] }
  | { type: "cluster"; clusterId: string };

export interface BatchStatusModalProps {
  open: boolean;
  onClose: () => void;
  target: BatchStatusTarget;
  /** Human count for the confirmation copy — for a cluster this is its current member count. */
  count: number;
}

export function BatchStatusModal({ open, onClose, target, count }: BatchStatusModalProps) {
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
          : `Apply the same status change to ${count} complaint${count === 1 ? "" : "s"}.`
      }
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={batch.isPending} onClick={handleApply}>
              Apply to {count} complaint{count === 1 ? "" : "s"}
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
            <Select
              id="batch-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as OfficerTargetStatus)}
            >
              <option value="">Select a status…</option>
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
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
