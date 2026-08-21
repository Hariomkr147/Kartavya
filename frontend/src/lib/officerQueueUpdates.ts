import i18n from "@/i18n";
import type { Complaint, ComplaintStatus } from "@/types/api";

/**
 * "What moved on complaints assigned to you, while you were away" — the
 * officer-side counterpart to `lib/complaintUpdates.ts`.
 *
 * The gap this closes: `/officer/complaints` has no per-officer scope and
 * claiming isn't a lock (any officer in the zone can act on any complaint),
 * so an officer whose claimed complaint gets resolved by someone else's
 * action — most commonly another member of the same cluster being resolved,
 * which cascades every eligible sibling to RESOLVED under actor SYSTEM —
 * currently finds out only by refreshing that complaint's own page. There is
 * no notifications endpoint in the contract, so this is the same
 * two-snapshots-in-localStorage trick the citizen side already uses.
 *
 * Deliberately silent on *why* it moved (cascade vs. another officer acting
 * on it directly) — the compact queue rows carry no `statusHistory`, so
 * that's genuinely unknown here. Opening the complaint answers it: the
 * timeline already labels a cascade entry with actor "System".
 */

export interface OfficerQueueSnapshotEntry {
  status: ComplaintStatus;
}

export type OfficerQueueSnapshot = Record<string, OfficerQueueSnapshotEntry>;

export interface OfficerQueueUpdate {
  /** Stable across re-renders and reloads, so the same change is never announced twice. */
  key: string;
  complaintId: string;
  categoryName: string;
  from: ComplaintStatus;
  to: ComplaintStatus;
  at: string;
  href: string;
}

export function officerUpdateMessage(update: OfficerQueueUpdate): string {
  return i18n.t("officerQueueUpdates.moved", {
    category: update.categoryName,
    complaintId: update.complaintId,
    status: i18n.t(`status.${update.to}`),
  });
}

export function snapshotOf(complaints: Complaint[]): OfficerQueueSnapshot {
  const snapshot: OfficerQueueSnapshot = {};
  for (const complaint of complaints) {
    snapshot[complaint.id] = { status: complaint.status };
  }
  return snapshot;
}

/**
 * Complaints assigned to this officer whose status the officer hasn't seen
 * yet, newest first. A null `previous` means this browser has never taken a
 * snapshot — the first visit records silently rather than announcing this
 * officer's entire existing workload back to them.
 */
export function diffOfficerQueue(
  previous: OfficerQueueSnapshot | null,
  complaints: Complaint[],
): OfficerQueueUpdate[] {
  if (!previous) return [];

  return complaints
    .flatMap((complaint) => {
      const before = previous[complaint.id];
      // Unknown ids are complaints assigned since the last snapshot (a fresh
      // claim) — the officer just did that themselves, so it's not news.
      if (!before || before.status === complaint.status) return [];
      const at = complaint.updatedAt ?? complaint.createdAt;
      return [
        {
          key: `${complaint.id}:${before.status}->${complaint.status}`,
          complaintId: complaint.id,
          categoryName: complaint.category.name,
          from: before.status,
          to: complaint.status,
          at,
          href: `/officer/queue/${complaint.id}`,
        } satisfies OfficerQueueUpdate,
      ];
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
