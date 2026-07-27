/**
 * How many *other* citizens reported the same issue, derived — not stored.
 *
 * The contract defines `ComplaintDetail.severityScore` exactly as
 * `(unique_reporter_count − 1) × 3 + upvoteCount`, so with both terms in hand
 * the reporter count is recoverable without the cluster endpoints (which are
 * officer/admin-scoped and unreachable from a citizen's token).
 *
 * Returns null rather than guessing whenever the arithmetic doesn't come out
 * clean — a missing field, a negative remainder, or a non-multiple of 3 all
 * mean the formula's assumptions don't hold for this row, and a wrong count
 * is worse than none.
 */
export function otherReporterCount(
  severityScore: number | null | undefined,
  upvoteCount: number | null | undefined,
): number | null {
  if (severityScore == null || upvoteCount == null) return null;
  const fromReporters = severityScore - upvoteCount;
  if (fromReporters < 0 || fromReporters % 3 !== 0) return null;
  return fromReporters / 3;
}
