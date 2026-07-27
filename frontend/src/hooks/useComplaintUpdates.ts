import { useCallback, useEffect, useMemo, useState } from "react";
import { useMyComplaints } from "@/hooks/useMyComplaints";
import { useAuth } from "@/contexts/AuthContext";
import {
  diffComplaints,
  snapshotOf,
  type ComplaintSnapshot,
  type ComplaintUpdate,
} from "@/lib/complaintUpdates";

const PREFIX = "kartavya-seen-complaints:";
// Matches the citizen dashboard's own working-set size — the diff must cover
// the whole history, not just the newest page, or a complaint that moved
// while it sat on page 2 would never be reported.
const FETCH_SIZE = 100;

function readSnapshot(namespace: string): ComplaintSnapshot | null {
  try {
    const raw = localStorage.getItem(PREFIX + namespace);
    return raw ? (JSON.parse(raw) as ComplaintSnapshot) : null;
  } catch {
    return null;
  }
}

function writeSnapshot(namespace: string, snapshot: ComplaintSnapshot) {
  try {
    localStorage.setItem(PREFIX + namespace, JSON.stringify(snapshot));
  } catch {
    // Best-effort — this is a convenience layer, never required state.
  }
}

/**
 * "What moved since you last looked", built entirely from two reads of
 * `/complaints/my` — the contract has no notifications endpoint, and this
 * needs none. The snapshot lives in localStorage keyed by user id so two
 * accounts sharing a browser never see each other's activity.
 *
 * The very first visit records the snapshot without reporting anything:
 * announcing a citizen's entire back catalogue as "new" would be noise.
 * After that, updates persist until explicitly acknowledged, so a change
 * can't be missed by loading the page while distracted.
 */
export function useComplaintUpdates() {
  const { user } = useAuth();
  const namespace = user?.id ?? "anon";
  const { data, isLoading } = useMyComplaints({
    pageSize: FETCH_SIZE,
    sort: "-updatedAt",
  });

  const [snapshot, setSnapshot] = useState<ComplaintSnapshot | null>(() =>
    readSnapshot(namespace),
  );
  const [loadedNamespace, setLoadedNamespace] = useState(namespace);

  const complaints = useMemo(() => data?.data ?? [], [data]);

  // Both of these adjust state during render — React's documented pattern for
  // "derive from something that changed", and cheaper than an effect, which
  // would render once with the stale value first.
  if (loadedNamespace !== namespace) {
    // The account changed underneath us: re-point at that user's snapshot
    // rather than diffing one citizen's complaints against another's.
    setLoadedNamespace(namespace);
    setSnapshot(readSnapshot(namespace));
  } else if (!isLoading && snapshot === null && complaints.length > 0) {
    // First run on this browser: adopt the current state silently so the next
    // visit has something to compare against.
    setSnapshot(snapshotOf(complaints));
  }

  // Persisting React state into an external store is exactly an effect's job.
  useEffect(() => {
    if (snapshot) writeSnapshot(namespace, snapshot);
  }, [snapshot, namespace]);

  const updates = useMemo<ComplaintUpdate[]>(
    () => diffComplaints(snapshot, complaints),
    [snapshot, complaints],
  );

  const acknowledge = useCallback(() => setSnapshot(snapshotOf(complaints)), [complaints]);

  return { updates, acknowledge, isLoading };
}
