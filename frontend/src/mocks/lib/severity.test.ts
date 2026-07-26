import { describe, expect, it } from "vitest";
import { severityScore, severityLabel } from "./severity";

describe("severityScore", () => {
  it("matches the CLUSTERED_COMPLAINT_LIFECYCLE.MD worked examples", () => {
    expect(severityScore(1, 0)).toBe(0); // standalone, no upvotes
    expect(severityScore(2, 0)).toBe(3); // two distinct reporters, no upvotes
    expect(severityScore(3, 2)).toBe(8); // three reporters, two upvotes
  });

  it("counts distinct reporters, not raw report count — duplicates from one citizen cannot inflate it", () => {
    // "Three reports from only one citizen, 2 upvotes" -> uniqueReporterCount stays 1.
    expect(severityScore(1, 2)).toBe(2);
  });
});

describe("severityLabel", () => {
  it.each([
    [0, "LOW"],
    [4, "LOW"],
    [5, "MEDIUM"],
    [14, "MEDIUM"],
    [15, "HIGH"],
    [29, "HIGH"],
    [30, "CRITICAL"],
    [100, "CRITICAL"],
  ] as const)("scores %i as %s", (score, label) => {
    expect(severityLabel(score)).toBe(label);
  });
});
