import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import type { ComplaintStatus, SeverityLabel, SlaLabel } from "@/types/api";

const STATUS_LABELS: Record<ComplaintStatus, string> = {
  SUBMITTED: "Submitted",
  EVIDENCE_UNDER_REVIEW: "Evidence under review",
  NEEDS_MORE_EVIDENCE: "Needs more evidence",
  REJECTED: "Rejected",
  UNDER_REVIEW: "Under review",
  IN_PROGRESS: "In progress",
  UNDER_RESOLUTION: "Under resolution",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  UNRESOLVABLE: "Unresolvable",
};

// Tailwind can't see dynamically-built class strings, so each variant's
// classes are written out in full here rather than composed from the status
// key at runtime.
const STATUS_CLASSES: Record<ComplaintStatus, string> = {
  SUBMITTED: "bg-status-submitted-subtle text-status-submitted",
  EVIDENCE_UNDER_REVIEW:
    "bg-status-evidence_under_review-subtle text-status-evidence_under_review",
  NEEDS_MORE_EVIDENCE:
    "bg-status-needs_more_evidence-subtle text-status-needs_more_evidence",
  REJECTED: "bg-status-rejected-subtle text-status-rejected",
  UNDER_REVIEW: "bg-status-under_review-subtle text-status-under_review",
  IN_PROGRESS: "bg-status-in_progress-subtle text-status-in_progress",
  UNDER_RESOLUTION: "bg-status-under_resolution-subtle text-status-under_resolution",
  RESOLVED: "bg-status-resolved-subtle text-status-resolved",
  CLOSED: "bg-status-closed-subtle text-status-closed",
  REOPENED: "bg-status-reopened-subtle text-status-reopened",
  UNRESOLVABLE: "bg-status-unresolvable-subtle text-status-unresolvable",
};

const DOT_CLASSES: Record<ComplaintStatus, string> = {
  SUBMITTED: "bg-status-submitted",
  EVIDENCE_UNDER_REVIEW: "bg-status-evidence_under_review",
  NEEDS_MORE_EVIDENCE: "bg-status-needs_more_evidence",
  REJECTED: "bg-status-rejected",
  UNDER_REVIEW: "bg-status-under_review",
  IN_PROGRESS: "bg-status-in_progress",
  UNDER_RESOLUTION: "bg-status-under_resolution",
  RESOLVED: "bg-status-resolved",
  CLOSED: "bg-status-closed",
  REOPENED: "bg-status-reopened",
  UNRESOLVABLE: "bg-status-unresolvable",
};

function BasePill({ className, children, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function StatusPill({
  status,
  className,
}: {
  status: ComplaintStatus;
  className?: string;
}) {
  return (
    <BasePill className={cn(STATUS_CLASSES[status], className)}>
      <span
        className={cn("size-1.5 rounded-full", DOT_CLASSES[status])}
        aria-hidden="true"
      />
      {STATUS_LABELS[status]}
    </BasePill>
  );
}

const SEVERITY_LABELS: Record<SeverityLabel, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

// LOW is deliberately neutral rather than green: it's the floor value and
// appears on most rows, so colouring it competed with the status pill beside
// it — and a green "Low" next to a green "Closed" read as a second positive
// outcome rather than a severity. MEDIUM upwards keep their escalating hues,
// which is what should actually catch the eye.
const SEVERITY_CLASSES: Record<SeverityLabel, string> = {
  LOW: "bg-surface-hover text-ink-muted",
  MEDIUM: "bg-severity-medium-subtle text-severity-medium",
  HIGH: "bg-severity-high-subtle text-severity-high",
  CRITICAL: "bg-severity-critical-subtle text-severity-critical",
};

export function SeverityPill({
  severity,
  className,
}: {
  severity: SeverityLabel;
  className?: string;
}) {
  return (
    <BasePill className={cn(SEVERITY_CLASSES[severity], className)}>
      {SEVERITY_LABELS[severity]}
    </BasePill>
  );
}

const SLA_LABELS: Record<SlaLabel, string> = {
  ON_TIME: "On time",
  DELAYED: "Delayed",
  OVERDUE: "Overdue",
};

/** Past tense, for a complaint that has already finished. */
const SLA_PAST_LABELS: Record<SlaLabel, string> = {
  ON_TIME: "Closed on time",
  DELAYED: "Closed late",
  OVERDUE: "Closed overdue",
};

const SLA_CLASSES: Record<SlaLabel, string> = {
  ON_TIME: "bg-sla-on_time-subtle text-sla-on_time",
  DELAYED: "bg-sla-delayed-subtle text-sla-delayed",
  OVERDUE: "bg-sla-overdue-subtle text-sla-overdue",
};

export function SlaPill({
  sla,
  className,
  past = false,
}: {
  sla: SlaLabel;
  className?: string;
  /**
   * Render as settled history rather than a live alarm. A finished complaint
   * still carries the SLA label it ended on, but a red "Overdue" on something
   * nobody can act on any more shouts over the rows that do need attention.
   */
  past?: boolean;
}) {
  return (
    <BasePill
      className={cn(
        past ? "bg-surface-hover text-ink-faint" : SLA_CLASSES[sla],
        className,
      )}
    >
      {past ? SLA_PAST_LABELS[sla] : SLA_LABELS[sla]}
    </BasePill>
  );
}
