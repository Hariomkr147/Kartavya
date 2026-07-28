import { useCallback, useEffect, useMemo, useState } from "react";
import { useOfficerQueue } from "@/hooks/useOfficerQueue";
import { useAuth } from "@/contexts/AuthContext";
import {
  diffOfficerQueue,
  snapshotOf,
  type OfficerQueueSnapshot,
  type OfficerQueueUpdate,
} from "@/lib/officerQueueUpdates";

const PREFIX = "kartavya-seen-officer-queue:";
// Large enough to cover a zone's whole active workload, matching the same
// FETCH_SIZE pattern the officer dashboard and citizen updates hook both use
// for a client-side count/diff over more than one page.
const FETCH_SIZE = 100;

function readSnapshot(namespace: string): OfficerQueueSnapshot | null {
  try {
    const raw = localStorage.getItem(PREFIX + namespace);
    return raw ? (JSON.parse(raw) as OfficerQueueSnapshot) : null;
  } catch {
    return null;
  }
}

function writeSnapshot(namespace: string, snapshot: OfficerQueueSnapshot) {
  try {
    localStorage.setItem(PREFIX + namespace, JSON.stringify(snapshot));
  } catch {
    // Best-effort — this is a convenience layer, never required state.
  }
}

/**
 * "What moved on complaints assigned to you, while you were away" — see
 * `lib/officerQueueUpdates.ts` for why this exists. No status filter: a
 * complaint assigned to this officer that got rejected or closed while they
 * were away is exactly as worth surfacing as one that got resolved.
 */
export function useOfficerQueueUpdates() {
  const { user } = useAuth();
  const namespace = user?.id ?? "anon";
  const { data, isLoading } = useOfficerQueue({ pageSize: FETCH_SIZE });

  const [snapshot, setSnapshot] = useState<OfficerQueueSnapshot | null>(() =>
    readSnapshot(namespace),
  );
  const [loadedNamespace, setLoadedNamespace] = useState(namespace);

  const mine = useMemo(
    () => (data?.data ?? []).filter((c) => c.assignedOfficerId === user?.id),
    [data, user],
  );

  // Both of these adjust state during render — React's documented pattern for
  // "derive from something that changed", and cheaper than an effect, which
  // would render once with the stale value first.
  if (loadedNamespace !== namespace) {
    // The account changed underneath us: re-point at that officer's snapshot
    // rather than diffing one officer's queue against another's.
    setLoadedNamespace(namespace);
    setSnapshot(readSnapshot(namespace));
  } else if (!isLoading && snapshot === null && mine.length > 0) {
    // First run on this browser: adopt the current state silently so the next
    // visit has something to compare against.
    setSnapshot(snapshotOf(mine));
  }

  // Persisting React state into an external store is exactly an effect's job.
  useEffect(() => {
    if (snapshot) writeSnapshot(namespace, snapshot);
  }, [snapshot, namespace]);

  const updates = useMemo<OfficerQueueUpdate[]>(
    () => diffOfficerQueue(snapshot, mine),
    [snapshot, mine],
  );

  const acknowledge = useCallback(() => setSnapshot(snapshotOf(mine)), [mine]);

  return { updates, acknowledge, isLoading };
}
