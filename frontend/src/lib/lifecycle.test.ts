import { describe, expect, it } from "vitest";
import { describeLifecycle, latestStatusReason } from "./lifecycle";
import type { ComplaintStatus, StatusHistoryEntry } from "@/types/api";

let sequence = 0;
function entry(
  toStatus: ComplaintStatus,
  fields: Partial<StatusHistoryEntry> = {},
): StatusHistoryEntry {
  sequence += 1;
  return {
    id: `sh_${sequence}`,
    toStatus,
    changedByRole: "OFFICER",
    timestamp: new Date(Date.UTC(2026, 6, sequence)).toISOString(),
    ...fields,
  } as StatusHistoryEntry;
}

function stateOf(status: ComplaintStatus) {
  return Object.fromEntries(
    describeLifecycle(status).stages.map((stage) => [stage.key, stage.state]),
  );
}

describe("describeLifecycle", () => {
  it("puts a fresh complaint on the first stage with everything ahead of it", () => {
    expect(stateOf("SUBMITTED")).toEqual({
      FILED: "current",
      EVIDENCE: "upcoming",
      ACCEPTED: "upcoming",
      WORKING: "upcoming",
      FIXED: "upcoming",
      CLOSED: "upcoming",
    });
  });

  it("marks every earlier stage done once work is underway", () => {
    const states = stateOf("IN_PROGRESS");
    expect(states.FILED).toBe("done");
    expect(states.EVIDENCE).toBe("done");
    expect(states.ACCEPTED).toBe("done");
    expect(states.WORKING).toBe("current");
    expect(states.CLOSED).toBe("upcoming");
  });

  it("flags the stages where the ball is in the citizen's court", () => {
    expect(stateOf("NEEDS_MORE_EVIDENCE").EVIDENCE).toBe("attention");
    expect(stateOf("RESOLVED").FIXED).toBe("attention");
    expect(stateOf("REOPENED").WORKING).toBe("attention");
  });

  it("cancels the stages a terminal complaint will never reach", () => {
    const states = stateOf("REJECTED");
    expect(states.EVIDENCE).toBe("stopped");
    expect(states.ACCEPTED).toBe("cancelled");
    expect(states.CLOSED).toBe("cancelled");
    expect(describeLifecycle("REJECTED").isTerminal).toBe(true);
  });

  it("shows a closed complaint as finished, not still in progress", () => {
    const states = stateOf("CLOSED");
    expect(states.FIXED).toBe("done");
    expect(states.CLOSED).toBe("done");
  });

  it("never renders an earlier stage as upcoming behind a later one", () => {
    const states = stateOf("IN_PROGRESS");
    expect(states.EVIDENCE).toBe("done");
    expect(states.ACCEPTED).toBe("done");
  });

  it("never shows FIXED as done while a REOPENED dispute is under review", () => {
    // A dispute regresses WORKING behind a FIXED it already passed through —
    // FIXED must go back to "upcoming", not stay "done" from the earlier pass.
    const states = stateOf("REOPENED");
    expect(states.WORKING).toBe("attention");
    expect(states.FIXED).toBe("upcoming");
  });

  it("labels the detour off the happy path", () => {
    expect(describeLifecycle("NEEDS_MORE_EVIDENCE").detour?.tone).toBe("warning");
    expect(describeLifecycle("UNRESOLVABLE").detour?.tone).toBe("bad");
    expect(describeLifecycle("IN_PROGRESS").detour).toBeNull();
  });
});

describe("latestStatusReason", () => {
  it("returns the newest reason recorded for the current status", () => {
    const history = [
      entry("REJECTED", {
        reason: "Old reason",
        timestamp: "2026-07-01T00:00:00.000Z",
      }),
      entry("REJECTED", {
        reason: "Not a civic issue",
        timestamp: "2026-07-09T00:00:00.000Z",
      }),
    ];
    expect(latestStatusReason("REJECTED", history)).toBe("Not a civic issue");
  });

  it("falls back to the remark when there's no reason", () => {
    const history = [entry("RESOLVED", { remark: "Filled and re-tarred." })];
    expect(latestStatusReason("RESOLVED", history)).toBe("Filled and re-tarred.");
  });

  it("is null when nothing was recorded", () => {
    expect(latestStatusReason("IN_PROGRESS", [entry("IN_PROGRESS")])).toBeNull();
    expect(latestStatusReason("IN_PROGRESS", [])).toBeNull();
  });
});
