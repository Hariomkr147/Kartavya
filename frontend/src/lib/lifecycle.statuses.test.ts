import { describe, expect, it } from "vitest";
import { OPEN_STATUSES, TERMINAL_STATUSES } from "./lifecycle";
import type { ComplaintStatus } from "@/types/api";

/**
 * The API filters complaints by inclusion — there is no "status is not one of
 * these" parameter — so hiding the three terminal statuses means naming the
 * other eight. That list is only correct while it stays exhaustive, and the
 * failure is silent: a status added to the contract and missed here would
 * simply stop appearing on the zone map, with nothing to notice it.
 */
const CONTRACT_STATUSES: ComplaintStatus[] = [
  "SUBMITTED",
  "EVIDENCE_UNDER_REVIEW",
  "NEEDS_MORE_EVIDENCE",
  "REJECTED",
  "UNDER_REVIEW",
  "IN_PROGRESS",
  "UNDER_RESOLUTION",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "UNRESOLVABLE",
];

describe("complaint status partition", () => {
  it("splits every contract status into exactly one of open or terminal", () => {
    expect([...OPEN_STATUSES, ...TERMINAL_STATUSES].sort()).toEqual(
      [...CONTRACT_STATUSES].sort(),
    );
  });

  it("agrees with schema.dbml on which three are terminal", () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(
      ["CLOSED", "REJECTED", "UNRESOLVABLE"].sort(),
    );
  });

  it("never lets a terminal status into the open set", () => {
    for (const status of TERMINAL_STATUSES) {
      expect(OPEN_STATUSES).not.toContain(status);
    }
  });

  it("keeps REOPENED open — a reopened complaint is live work again", () => {
    expect(OPEN_STATUSES).toContain("REOPENED");
  });
});
