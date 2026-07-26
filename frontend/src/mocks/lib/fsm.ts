import type { ComplaintStatus, EvidenceVerdict } from "../db/types";

/** REJECTED, CLOSED, UNRESOLVABLE — a complaint here can never move again. */
export const TERMINAL_STATUSES: ReadonlySet<ComplaintStatus> = new Set([
  "REJECTED",
  "CLOSED",
  "UNRESOLVABLE",
]);

/** Has this complaint's SLA clock legally reached UNDER_REVIEW or later? Used for admin-override SLA backfill. */
export const AT_OR_PAST_UNDER_REVIEW: ReadonlySet<ComplaintStatus> = new Set([
  "UNDER_REVIEW",
  "IN_PROGRESS",
  "UNDER_RESOLUTION",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "UNRESOLVABLE",
]);

/** The 5 targets an officer may request via the status / batch-status endpoints. */
export type OfficerTargetStatus =
  | "IN_PROGRESS"
  | "UNDER_RESOLUTION"
  | "RESOLVED"
  | "UNRESOLVABLE"
  | "NEEDS_MORE_EVIDENCE";

const OFFICER_TARGET_STATUSES: readonly OfficerTargetStatus[] = [
  "IN_PROGRESS",
  "UNDER_RESOLUTION",
  "RESOLVED",
  "UNRESOLVABLE",
  "NEEDS_MORE_EVIDENCE",
];

export function isOfficerTargetStatus(status: string): status is OfficerTargetStatus {
  return (OFFICER_TARGET_STATUSES as readonly string[]).includes(status);
}

/** Legal current-status set for each officer-triggerable target (openapi.yaml's OfficerTargetStatus). */
const OFFICER_TRANSITIONS: Record<OfficerTargetStatus, ComplaintStatus[]> = {
  IN_PROGRESS: ["UNDER_REVIEW"],
  UNDER_RESOLUTION: ["IN_PROGRESS"],
  RESOLVED: ["UNDER_RESOLUTION"],
  UNRESOLVABLE: ["UNDER_REVIEW", "IN_PROGRESS", "UNDER_RESOLUTION"],
  NEEDS_MORE_EVIDENCE: ["UNDER_REVIEW"],
};

const REASON_REQUIRED_TARGETS: readonly OfficerTargetStatus[] = [
  "UNRESOLVABLE",
  "NEEDS_MORE_EVIDENCE",
];

export type TransitionFailureCode =
  "INVALID_TRANSITION" | "NOT_IN_ZONE" | "UNKNOWN_COMPLAINT" | "REASON_REQUIRED";

export type TransitionCheck =
  { ok: true } | { ok: false; errorCode: TransitionFailureCode; message: string };

/** Validates a single officer status/batch-status item against the current status + reason. */
export function validateOfficerTransition(
  currentStatus: ComplaintStatus,
  target: OfficerTargetStatus,
  reason: string | undefined,
): TransitionCheck {
  const legalFrom = OFFICER_TRANSITIONS[target];
  if (!legalFrom.includes(currentStatus)) {
    return {
      ok: false,
      errorCode: "INVALID_TRANSITION",
      message: `Cannot move from ${currentStatus} to ${target}.`,
    };
  }
  if (REASON_REQUIRED_TARGETS.includes(target) && !reason?.trim()) {
    return {
      ok: false,
      errorCode: "REASON_REQUIRED",
      message: `A reason is required when moving to ${target}.`,
    };
  }
  return { ok: true };
}

export type EvidenceReviewCheck =
  { ok: true } | { ok: false; status: 400 | 409; code: string; message: string };

/**
 * Validates an evidence-review call. `slaStartedAt` set means the complaint
 * has already reached UNDER_REVIEW at least once — REJECTED is only legal
 * on a first evidence round (openapi.yaml's evidence_verdict note).
 */
export function validateEvidenceReview(
  currentStatus: ComplaintStatus,
  slaStartedAt: string | null,
  verdict: EvidenceVerdict,
  reason: string | undefined,
): EvidenceReviewCheck {
  if (currentStatus !== "EVIDENCE_UNDER_REVIEW") {
    return {
      ok: false,
      status: 409,
      code: "INVALID_TRANSITION",
      message: "This complaint is not at the evidence-review stage.",
    };
  }
  if (verdict === "REJECTED" && slaStartedAt !== null) {
    return {
      ok: false,
      status: 409,
      code: "INVALID_TRANSITION",
      message:
        "This complaint already passed its first evidence round — it can only be accepted or sent back for more evidence now, not rejected.",
    };
  }
  if ((verdict === "NEEDS_MORE_EVIDENCE" || verdict === "REJECTED") && !reason?.trim()) {
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      message: `A reason is required when the verdict is ${verdict}.`,
    };
  }
  return { ok: true };
}
