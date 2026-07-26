import { describe, expect, it } from "vitest";
import { validateOfficerTransition, validateEvidenceReview } from "./fsm";

describe("validateOfficerTransition", () => {
  it("allows the documented officer-triggerable transitions", () => {
    expect(validateOfficerTransition("UNDER_REVIEW", "IN_PROGRESS", undefined).ok).toBe(
      true,
    );
    expect(
      validateOfficerTransition("IN_PROGRESS", "UNDER_RESOLUTION", undefined).ok,
    ).toBe(true);
    expect(validateOfficerTransition("UNDER_RESOLUTION", "RESOLVED", undefined).ok).toBe(
      true,
    );
  });

  it("rejects an illegal jump with INVALID_TRANSITION", () => {
    const result = validateOfficerTransition("SUBMITTED", "RESOLVED", undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("INVALID_TRANSITION");
  });

  it("never allows REOPENED to be moved through this door — the admin dispute-review is the only exit", () => {
    for (const target of [
      "IN_PROGRESS",
      "UNDER_RESOLUTION",
      "RESOLVED",
      "UNRESOLVABLE",
      "NEEDS_MORE_EVIDENCE",
    ] as const) {
      const result = validateOfficerTransition("REOPENED", target, "any reason");
      expect(result.ok).toBe(false);
    }
  });

  it("requires a reason for UNRESOLVABLE and NEEDS_MORE_EVIDENCE", () => {
    const missing = validateOfficerTransition("UNDER_REVIEW", "UNRESOLVABLE", undefined);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errorCode).toBe("REASON_REQUIRED");

    const present = validateOfficerTransition(
      "UNDER_REVIEW",
      "UNRESOLVABLE",
      "budget blocked",
    );
    expect(present.ok).toBe(true);
  });

  it("only allows the post-acceptance NEEDS_MORE_EVIDENCE recall from UNDER_REVIEW", () => {
    expect(
      validateOfficerTransition("IN_PROGRESS", "NEEDS_MORE_EVIDENCE", "reason").ok,
    ).toBe(false);
    expect(
      validateOfficerTransition("UNDER_REVIEW", "NEEDS_MORE_EVIDENCE", "reason").ok,
    ).toBe(true);
  });
});

describe("validateEvidenceReview", () => {
  it("requires the complaint to be at EVIDENCE_UNDER_REVIEW", () => {
    const result = validateEvidenceReview("SUBMITTED", null, "VALID", undefined);
    expect(result.ok).toBe(false);
  });

  it("requires a reason for NEEDS_MORE_EVIDENCE and REJECTED", () => {
    const noReason = validateEvidenceReview(
      "EVIDENCE_UNDER_REVIEW",
      null,
      "REJECTED",
      undefined,
    );
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.status).toBe(400);

    const withReason = validateEvidenceReview(
      "EVIDENCE_UNDER_REVIEW",
      null,
      "REJECTED",
      "fake photo",
    );
    expect(withReason.ok).toBe(true);
  });

  it("blocks REJECTED once the complaint has already reached UNDER_REVIEW before (post-acceptance recall)", () => {
    const result = validateEvidenceReview(
      "EVIDENCE_UNDER_REVIEW",
      "2026-01-01T00:00:00.000Z",
      "REJECTED",
      "fake photo",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("still allows VALID and NEEDS_MORE_EVIDENCE on a post-acceptance re-review", () => {
    expect(
      validateEvidenceReview(
        "EVIDENCE_UNDER_REVIEW",
        "2026-01-01T00:00:00.000Z",
        "VALID",
        undefined,
      ).ok,
    ).toBe(true);
    expect(
      validateEvidenceReview(
        "EVIDENCE_UNDER_REVIEW",
        "2026-01-01T00:00:00.000Z",
        "NEEDS_MORE_EVIDENCE",
        "still unclear",
      ).ok,
    ).toBe(true);
  });
});
