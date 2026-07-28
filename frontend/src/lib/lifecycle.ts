import type { ComplaintStatus, StatusHistoryEntry } from "@/types/api";

/**
 * The citizen-facing reading of the server-enforced state machine in
 * `schema.dbml`. The status history already tells a citizen where their
 * complaint has *been*; this collapses the eleven contract statuses into the
 * six stages a complaint actually passes through so the UI can also show
 * where it is *going* — which the timeline alone never answers.
 *
 * Nothing here is stored or sent anywhere: it is a pure projection of
 * `status` + `statusHistory`, both of which come straight off
 * `ComplaintDetail`.
 */

export type StageKey =
  | "FILED"
  | "EVIDENCE"
  | "ACCEPTED"
  | "WORKING"
  | "FIXED"
  | "CLOSED";

export type StageState =
  | "done"
  /** The complaint is sitting here right now. */
  | "current"
  /** Sitting here, but the ball is in the citizen's court (or an admin's). */
  | "attention"
  /** Where a rejected/unresolvable complaint came to a halt. */
  | "stopped"
  | "upcoming"
  /** The complaint stopped for good before reaching this stage. */
  | "cancelled";

export interface LifecycleStage {
  key: StageKey;
  label: string;
  /** One line of plain-language "what this means", shown under the current stage. */
  hint: string;
  state: StageState;
}

const STAGE_ORDER: StageKey[] = [
  "FILED",
  "EVIDENCE",
  "ACCEPTED",
  "WORKING",
  "FIXED",
  "CLOSED",
];

const STAGE_LABELS: Record<StageKey, string> = {
  FILED: "Filed",
  EVIDENCE: "Evidence check",
  ACCEPTED: "Accepted",
  WORKING: "Being fixed",
  FIXED: "Fixed",
  CLOSED: "Closed",
};

const STAGE_HINTS: Record<StageKey, string> = {
  FILED: "Your report reached the zone office and is waiting to be picked up.",
  EVIDENCE: "An officer is checking your photos before the work is scheduled.",
  ACCEPTED: "Accepted as a genuine issue — the resolution clock is running.",
  WORKING: "An officer is on it. You'll be asked to confirm once they're done.",
  FIXED: "The officer says it's fixed — your confirmation closes it for good.",
  CLOSED: "This report is finished.",
};

/** Which stage each contract status belongs to. */
const STATUS_STAGE: Record<ComplaintStatus, StageKey> = {
  SUBMITTED: "FILED",
  EVIDENCE_UNDER_REVIEW: "EVIDENCE",
  NEEDS_MORE_EVIDENCE: "EVIDENCE",
  REJECTED: "EVIDENCE",
  UNDER_REVIEW: "ACCEPTED",
  IN_PROGRESS: "WORKING",
  UNDER_RESOLUTION: "WORKING",
  REOPENED: "WORKING",
  UNRESOLVABLE: "WORKING",
  RESOLVED: "FIXED",
  CLOSED: "CLOSED",
};

/** Terminal per the schema — nothing follows these. */
const TERMINAL: ComplaintStatus[] = ["REJECTED", "CLOSED", "UNRESOLVABLE"];

/** Statuses where the complaint is parked waiting on somebody other than the officer. */
const ATTENTION: ComplaintStatus[] = ["NEEDS_MORE_EVIDENCE", "RESOLVED", "REOPENED"];

export interface Lifecycle {
  stages: LifecycleStage[];
  currentIndex: number;
  /** True once the complaint can never move again (REJECTED / CLOSED / UNRESOLVABLE). */
  isTerminal: boolean;
  /** Set when the complaint is off the happy path, e.g. "Needs more evidence". */
  detour: { label: string; tone: "warning" | "bad" } | null;
}

const DETOURS: Partial<Record<ComplaintStatus, { label: string; tone: "warning" | "bad" }>> =
  {
    NEEDS_MORE_EVIDENCE: { label: "Paused — more evidence needed", tone: "warning" },
    REOPENED: { label: "Reopened — dispute under review", tone: "warning" },
    REJECTED: { label: "Rejected — stopped here", tone: "bad" },
    UNRESOLVABLE: { label: "Marked unresolvable — stopped here", tone: "bad" },
  };

export function describeLifecycle(status: ComplaintStatus): Lifecycle {
  const currentStage = STATUS_STAGE[status];
  const currentIndex = STAGE_ORDER.indexOf(currentStage);
  const isTerminal = TERMINAL.includes(status);

  const stages = STAGE_ORDER.map((key, index): LifecycleStage => {
    let state: StageState;
    if (index < currentIndex) state = "done";
    else if (index === currentIndex) {
      state =
        status === "CLOSED"
          ? "done"
          : isTerminal
            ? "stopped"
            : ATTENTION.includes(status)
              ? "attention"
              : "current";
    } else if (isTerminal) state = "cancelled";
    // A stage strictly after the current one is always "upcoming" — even if
    // a REOPENED dispute previously reached it (e.g. RESOLVED/FIXED) before
    // regressing back to WORKING, since that earlier pass is exactly what's
    // now in question. Marking it "done" here would tell the citizen the fix
    // is confirmed-good at the moment they're disputing that it isn't.
    else state = "upcoming";

    return { key, label: STAGE_LABELS[key], hint: STAGE_HINTS[key], state };
  });

  return {
    stages,
    currentIndex,
    isTerminal,
    detour: DETOURS[status] ?? null,
  };
}

/**
 * The most recent `reason`/`remark` the server recorded for the complaint's
 * current status — the officer's rejection reason, the admin's dispute
 * verdict, and so on. `status_history` is append-only, so the newest entry
 * matching the current status is the authoritative explanation.
 */
export function latestStatusReason(
  status: ComplaintStatus,
  statusHistory?: StatusHistoryEntry[],
): string | null {
  const matching = (statusHistory ?? [])
    .filter((entry) => entry.toStatus === status)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const newest = matching[0];
  if (!newest) return null;
  return newest.reason?.trim() || newest.remark?.trim() || null;
}
