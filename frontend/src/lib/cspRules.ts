import i18n from "@/i18n";
import type { PointsLedgerEntry } from "@/types/api";

export type CspReason = PointsLedgerEntry["reason"];

/** Reason labels, resolved through i18next so they follow the active language. */
export function cspReasonLabel(reason: CspReason): string {
  return i18n.t(`csp.reason.${reason}`);
}

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
 *
 * Listed here in published order with their documented amounts; the copy
 * itself lives in the locale bundles.
 */
const DOCUMENTED_AMOUNTS: [CspReason, number][] = [
  ["COMPLAINT_CLOSED", 50],
  ["ON_TIME_BONUS", 15],
  ["CLUSTER_MEMBER_CLOSED", 10],
  ["FIRST_COMPLAINT", 10],
  ["UPVOTE_RECEIVED", 5],
  ["REJECTED_PENALTY", -20],
];

/** Built per call rather than as a module constant so the copy follows the active language. */
export function cspRules(): CspRule[] {
  return DOCUMENTED_AMOUNTS.map(([reason, documentedAmount]) => ({
    reason,
    label: cspReasonLabel(reason),
    documentedAmount,
    description: i18n.t(`csp.description.${reason}`),
  }));
}

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
