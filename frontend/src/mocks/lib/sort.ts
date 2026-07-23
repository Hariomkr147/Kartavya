import { db } from "../db/store";
import { slaElapsedSeconds } from "./sla";
import type { ComplaintRow } from "../db/types";

function slaPercentUsed(row: ComplaintRow): number {
  if (row.slaTargetHours == null || row.slaStartedAt == null) return -Infinity;
  const elapsedHours =
    slaElapsedSeconds(row.slaStartedAt, row.slaPausedSeconds, row.slaPausedAt) / 3600;
  return (elapsedHours / row.slaTargetHours) * 100;
}

function upvoteCount(row: ComplaintRow): number {
  return db.upvotes.filter((u) => u.complaintId === row.id).length;
}

/**
 * Applies the `sort` query param documented across complaint list endpoints:
 * a field name, `-` prefixed for descending (createdAt/updatedAt/severity/sla/upvotes).
 * Falls back to `defaultSort` when `sortParam` is absent/unrecognized.
 */
export function sortComplaints(
  rows: ComplaintRow[],
  sortParam: string | null,
  defaultSort: (a: ComplaintRow, b: ComplaintRow) => number,
): ComplaintRow[] {
  if (!sortParam) return [...rows].sort(defaultSort);

  const descending = sortParam.startsWith("-");
  const field = descending ? sortParam.slice(1) : sortParam;
  const direction = descending ? -1 : 1;

  const comparators: Record<string, (a: ComplaintRow, b: ComplaintRow) => number> = {
    createdAt: (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    updatedAt: (a, b) =>
      new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
    severity: (a, b) => a.severityScore - b.severityScore,
    sla: (a, b) => slaPercentUsed(a) - slaPercentUsed(b),
    upvotes: (a, b) => upvoteCount(a) - upvoteCount(b),
  };

  const comparator = comparators[field];
  if (!comparator) return [...rows].sort(defaultSort);
  return [...rows].sort((a, b) => direction * comparator(a, b));
}
