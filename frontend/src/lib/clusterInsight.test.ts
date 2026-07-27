import { describe, expect, it } from "vitest";
import { otherReporterCount } from "./clusterInsight";

/**
 * The contract's formula is
 * `severityScore = (unique_reporter_count − 1) × 3 + upvoteCount`, so these
 * cases run it backwards. Anything that doesn't invert cleanly must abstain
 * rather than show a made-up number.
 */
describe("otherReporterCount", () => {
  it("recovers the count for a clustered complaint", () => {
    // 4 reporters, 2 upvotes -> (4-1)*3 + 2 = 11
    expect(otherReporterCount(11, 2)).toBe(3);
  });

  it("is zero for a standalone complaint whose score is all upvotes", () => {
    expect(otherReporterCount(7, 7)).toBe(0);
    expect(otherReporterCount(0, 0)).toBe(0);
  });

  it("abstains when a term is missing", () => {
    expect(otherReporterCount(undefined, 3)).toBeNull();
    expect(otherReporterCount(11, null)).toBeNull();
  });

  it("abstains when the remainder isn't a whole number of reporters", () => {
    expect(otherReporterCount(10, 2)).toBeNull();
    expect(otherReporterCount(12, 2)).toBeNull();
  });

  it("abstains rather than returning a negative count", () => {
    expect(otherReporterCount(2, 5)).toBeNull();
  });
});
