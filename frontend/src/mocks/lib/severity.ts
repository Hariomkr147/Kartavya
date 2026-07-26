import type { SeverityLabel } from "../db/types";

/**
 * (unique reporters − 1) × 3 + upvotes — counts distinct citizens, never raw
 * report count, so one citizen filing duplicates cannot inflate urgency.
 * `uniqueReporterCount` is 1 for a standalone (unclustered) complaint.
 */
export function severityScore(uniqueReporterCount: number, upvoteCount: number): number {
  return (uniqueReporterCount - 1) * 3 + upvoteCount;
}

export function severityLabel(score: number): SeverityLabel {
  if (score >= 30) return "CRITICAL";
  if (score >= 15) return "HIGH";
  if (score >= 5) return "MEDIUM";
  return "LOW";
}
