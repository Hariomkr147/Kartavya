import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Label } from "@/components/ui/Label";
import { Textarea } from "@/components/ui/Textarea";
import { StatusPill } from "@/components/ui/pills";
import { useBatchUpdateStatus } from "@/hooks/useBatchUpdateStatus";
import { ApiRequestError } from "@/services/http";
import type { TranslationKey } from "@/i18n";
import type {
  BatchStatusUpdateResult,
  ComplaintStatus,
  OfficerTargetStatus,
} from "@/types/api";

const STATUS_OPTIONS: { value: OfficerTargetStatus; labelKey: TranslationKey }[] = [
  { value: "IN_PROGRESS", labelKey: "status.IN_PROGRESS" },
  { value: "UNDER_RESOLUTION", labelKey: "status.UNDER_RESOLUTION" },
  { value: "RESOLVED", labelKey: "status.RESOLVED" },
  { value: "NEEDS_MORE_EVIDENCE", labelKey: "batch.needsMoreEvidenceRecall" },
  { value: "UNRESOLVABLE", labelKey: "status.UNRESOLVABLE" },
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
  const { t } = useTranslation();
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
      setFormError(t("batch.chooseStatus"));
      return;
    }
    if (REASON_REQUIRED.has(status) && !reason.trim()) {
      setFormError(t("batch.reasonRequired"));
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
        error instanceof ApiRequestError ? error.message : t("errors.generic"),
      );
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={result ? t("batch.resultsTitle") : t("batch.title")}
      description={
        result
          ? undefined
          : status
            ? eligibleCount === total
              ? t("batch.descAll", { count: eligibleCount })
              : t("batch.descPartial", { count: total, eligible: eligibleCount })
            : t("batch.descChoose", { count: total })
      }
      footer={
        result ? (
          <Button onClick={onClose}>{t("common.done")}</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              loading={batch.isPending}
              disabled={!!status && eligibleCount === 0}
              onClick={handleApply}
            >
              {status ? t("batch.applyTo", { count: eligibleCount }) : t("batch.apply")}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <p className="text-ink-muted text-sm">
            {t("batch.summary", {
              succeeded: result.summary.succeeded,
              requested: result.summary.requested,
            })}
            {result.summary.failed > 0 &&
              t("batch.summaryFailed", { failed: result.summary.failed })}
            .
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
              {t("batch.targetStatus")}
            </Label>
            <Combobox
              id="batch-status"
              value={status}
              onChange={(v) => setStatus(v as OfficerTargetStatus)}
              placeholderDisabled
              options={[
                { value: "", label: t("batch.selectStatus") },
                ...STATUS_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t(option.labelKey),
                })),
              ]}
            />
          </div>
          {status && REASON_REQUIRED.has(status) && (
            <div>
              <Label htmlFor="batch-reason" required>
                {t("common.reason")}
              </Label>
              <Textarea
                id="batch-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("batch.reasonPlaceholder")}
              />
            </div>
          )}
          {status === "RESOLVED" && (
            <div>
              <Label htmlFor="batch-note">{t("batch.closingNote")}</Label>
              <Textarea
                id="batch-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("batch.notePlaceholder")}
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
