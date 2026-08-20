import i18n from "@/i18n";
import type { Complaint, ComplaintStatus } from "@/types/api";

/**
 * "What changed while you were away", computed client-side.
 *
 * There is no notifications endpoint in the contract, but `/complaints/my`
 * already returns every complaint's current `status` — so a snapshot of that
 * list, kept in localStorage per user, is enough to tell a returning citizen
 * exactly which of their reports moved. Nothing is sent anywhere; this is a
 * local diff of two reads of the same endpoint.
 *
 * Only *status* changes are reported. `updatedAt` also moves for changes a
 * citizen can't see the substance of from the list response, and announcing
 * "something changed" without being able to say what is worse than staying
 * quiet.
 */

export interface ComplaintSnapshotEntry {
  status: ComplaintStatus;
}

export type ComplaintSnapshot = Record<string, ComplaintSnapshotEntry>;

export interface ComplaintUpdate {
  /** Stable across re-renders and reloads, so the same change is never announced twice. */
  key: string;
  complaintId: string;
  categoryName: string;
  from: ComplaintStatus;
  to: ComplaintStatus;
  actionNeeded: Complaint["citizenActionNeeded"];
  at: string;
  href: string;
}

/**
 * The sentence is built from one whole-message key per status rather than a
 * shared frame plus a fragment: languages differ on where the category and
 * the verb phrase land in a sentence, and a fragment table can't be reordered
 * by a translator.
 */
export function updateMessage(update: ComplaintUpdate): string {
  return i18n.t(`complaintUpdates.${update.to}`, {
    category: update.categoryName.toLowerCase(),
  });
}

export function snapshotOf(complaints: Complaint[]): ComplaintSnapshot {
  const snapshot: ComplaintSnapshot = {};
  for (const complaint of complaints) {
    snapshot[complaint.id] = { status: complaint.status };
  }
  return snapshot;
}

/**
 * Complaints the citizen hasn't seen the current state of yet, newest first.
 * A null `previous` means this browser has never taken a snapshot — the
 * first visit records silently rather than announcing a citizen's entire
 * history back to them.
 */
export function diffComplaints(
  previous: ComplaintSnapshot | null,
  complaints: Complaint[],
): ComplaintUpdate[] {
  if (!previous) return [];

  return complaints
    .flatMap((complaint) => {
      const before = previous[complaint.id];
      // Unknown ids are complaints filed since the last snapshot — the
      // citizen filed them, so they are not news.
      if (!before || before.status === complaint.status) return [];
      const at = complaint.updatedAt ?? complaint.createdAt;
      return [
        {
          key: `${complaint.id}:${before.status}->${complaint.status}`,
          complaintId: complaint.id,
          categoryName: complaint.category.name,
          from: before.status,
          to: complaint.status,
          actionNeeded: complaint.citizenActionNeeded,
          at,
          href: `/citizen/complaints/${complaint.id}`,
        } satisfies ComplaintUpdate,
      ];
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
