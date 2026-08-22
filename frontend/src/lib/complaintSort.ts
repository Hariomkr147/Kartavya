import type { Complaint, ComplaintStatus, SeverityLabel, SlaLabel } from "@/types/api";
import type { ComparatorsByKey } from "@/hooks/useSortableRows";

/**
 * Ordering for the three enum-valued complaint columns.
 *
 * A column showing a pill has no useful alphabetical order — sorting
 * "CRITICAL / HIGH / LOW / MEDIUM" by label is noise. These ranks put each
 * enum in its domain order (worst last, so descending puts worst first) and
 * live here rather than in one page so every complaint table — the officer
 * queue, both cluster member lists — agrees on what "sorted by severity"
 * means. Mirrors `app/domain/enums.py`.
 */
export const SEVERITY_RANK: Record<SeverityLabel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export const SLA_RANK: Record<SlaLabel, number> = {
  ON_TIME: 0,
  DELAYED: 1,
  OVERDUE: 2,
};

/** Lifecycle order, not alphabetical — see `complaint_status` in schema.dbml. */
export const STATUS_RANK: Record<ComplaintStatus, number> = {
  SUBMITTED: 0,
  EVIDENCE_UNDER_REVIEW: 1,
  NEEDS_MORE_EVIDENCE: 2,
  UNDER_REVIEW: 3,
  IN_PROGRESS: 4,
  UNDER_RESOLUTION: 5,
  RESOLVED: 6,
  REOPENED: 7,
  CLOSED: 8,
  REJECTED: 9,
  UNRESOLVABLE: 10,
};

export type ComplaintSortKey =
  "id" | "category" | "status" | "severity" | "sla" | "upvotes" | "createdAt";

/**
 * Value-extractors for every complaint column any table sorts on. Individual
 * tables pick the subset matching the columns they render (`pickComparators`).
 *
 * Field names mirror the ones the server's `sort` query param recognizes
 * (createdAt/updatedAt/severity/sla/upvotes — `SORTABLE_FIELDS` in
 * `app/services/queries.py`) even though these run client-side, over rows
 * already loaded, so a column means the same thing whichever table it is in.
 */
export const COMPLAINT_COMPARATORS: ComparatorsByKey<Complaint, ComplaintSortKey> = {
  id: (row) => row.id,
  category: (row) => row.category.name,
  status: (row) => STATUS_RANK[row.status],
  severity: (row) => (row.severityLabel ? SEVERITY_RANK[row.severityLabel] : -1),
  sla: (row) => (row.slaLabel ? SLA_RANK[row.slaLabel] : -1),
  upvotes: (row) => row.upvoteCount ?? 0,
  createdAt: (row) => new Date(row.createdAt).getTime(),
};

/** Narrows the shared comparator map to the columns one table actually renders. */
export function pickComparators<K extends ComplaintSortKey>(
  ...keys: K[]
): ComparatorsByKey<Complaint, K> {
  return Object.fromEntries(
    keys.map((key) => [key, COMPLAINT_COMPARATORS[key]]),
  ) as ComparatorsByKey<Complaint, K>;
}
