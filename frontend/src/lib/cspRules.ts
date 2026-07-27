import type { PointsLedgerEntry } from "@/types/api";

export type CspReason = PointsLedgerEntry["reason"];

export const CSP_REASON_LABELS: Record<CspReason, string> = {
  COMPLAINT_CLOSED: "Complaint closed",
  CLUSTER_MEMBER_CLOSED: "Cluster member closed",
  FIRST_COMPLAINT: "First complaint bonus",
  ON_TIME_BONUS: "On-time bonus",
  UPVOTE_RECEIVED: "Upvote received",
  REJECTED_PENALTY: "Complaint rejected",
};

export interface CspRule {
  reason: CspReason;
  label: string;
  /** The award amount documented alongside `points_reason` in the schema. */
  documentedAmount: number;
  description: string;
}

/**
 * The published CSP award table. These amounts are the ones documented in
 * `schema.dbml` (`points_reason`) and in the `/complaints/{id}/confirm`
 * description — they are reference copy, not a client-side calculation: the
 * ledger the server returns stays the only record of what was actually
 * earned. `observedAmounts` below lets the UI prefer a citizen's own real
 * numbers over this table wherever their ledger already shows one, so the
 * page can never quietly disagree with itself if the server retunes an award.
 */
export const CSP_RULES: CspRule[] = [
  {
    reason: "COMPLAINT_CLOSED",
    label: CSP_REASON_LABELS.COMPLAINT_CLOSED,
    documentedAmount: 50,
    description: "You confirmed an officer's fix and the complaint closed.",
  },
  {
    reason: "ON_TIME_BONUS",
    label: CSP_REASON_LABELS.ON_TIME_BONUS,
    documentedAmount: 15,
    description: "That complaint closed inside its category's SLA target.",
  },
  {
    reason: "CLUSTER_MEMBER_CLOSED",
    label: CSP_REASON_LABELS.CLUSTER_MEMBER_CLOSED,
    documentedAmount: 10,
    description:
      "Someone else confirmed first on a shared issue you also reported. The full reward is paid once per cluster.",
  },
  {
    reason: "FIRST_COMPLAINT",
    label: CSP_REASON_LABELS.FIRST_COMPLAINT,
    documentedAmount: 10,
    description: "A one-time welcome bonus for your very first report.",
  },
  {
    reason: "UPVOTE_RECEIVED",
    label: CSP_REASON_LABELS.UPVOTE_RECEIVED,
    documentedAmount: 5,
    description: "A neighbour backed one of your reports on the feed.",
  },
  {
    reason: "REJECTED_PENALTY",
    label: CSP_REASON_LABELS.REJECTED_PENALTY,
    documentedAmount: -20,
    description: "An officer rejected a report as not a genuine civic issue.",
  },
];

/**
 * The most recent amount this citizen actually received per reason, read off
 * their own ledger. Used to display real numbers in place of the reference
 * table wherever one exists.
 */
export function observedAmounts(
  ledger: PointsLedgerEntry[],
): Partial<Record<CspReason, number>> {
  const newestFirst = [...ledger].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const observed: Partial<Record<CspReason, number>> = {};
  for (const entry of newestFirst) {
    if (observed[entry.reason] === undefined) observed[entry.reason] = entry.amount;
  }
  return observed;
}

export function formatCsp(amount: number): string {
  return `${amount >= 0 ? "+" : ""}${amount}`;
}
