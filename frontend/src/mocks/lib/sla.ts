import type { ComplaintRow, SlaLabel } from "../db/types";

/**
 * Seconds actually counted against the SLA target: wall-clock time since
 * sla_started_at, minus accumulated pause time, minus any currently-open
 * pause (paused_at set but not yet folded into paused_seconds).
 */
export function slaElapsedSeconds(
  startedAt: string,
  pausedSeconds: number,
  pausedAt: string | null,
  now: Date = new Date(),
): number {
  const startedMs = new Date(startedAt).getTime();
  let totalPausedSeconds = pausedSeconds;
  if (pausedAt) {
    totalPausedSeconds += (now.getTime() - new Date(pausedAt).getTime()) / 1000;
  }
  return (now.getTime() - startedMs) / 1000 - totalPausedSeconds;
}

/**
 * Derived on read, never stored — see schema.dbml's sla_label note.
 * Null before the SLA clock has started (slaTargetHours/slaStartedAt unset).
 */
export function slaLabel(
  targetHours: number | null,
  startedAt: string | null,
  pausedSeconds: number,
  pausedAt: string | null,
  now: Date = new Date(),
): SlaLabel | null {
  if (targetHours == null || startedAt == null) return null;
  const elapsedHours = slaElapsedSeconds(startedAt, pausedSeconds, pausedAt, now) / 3600;
  const percentUsed = (elapsedHours / targetHours) * 100;
  if (percentUsed < 80) return "ON_TIME";
  if (percentUsed < 100) return "DELAYED";
  return "OVERDUE";
}

/**
 * How long one complaint took to resolve, per the `AvgResolutionHours` schema:
 * `resolved_at − sla_started_at − sla_paused_seconds`, in hours.
 *
 * It measures the span the complaint was actually the officer's responsibility
 * — so it starts when the evidence was accepted and the clock began, not when
 * the citizen filed, and it excludes time parked in NEEDS_MORE_EVIDENCE. That
 * is the same arithmetic `slaLabel` uses, which is the point: a zone must never
 * be able to show every complaint ON_TIME alongside an average past its target.
 *
 * It deliberately stops at `resolved_at`, not `closed_at` — the wait for the
 * citizen to confirm is not the officer's to answer for.
 *
 * Null when the complaint is not in the sample at all: never resolved, or
 * resolved without the clock ever having started (rejected at evidence review).
 */
export function resolutionHours(complaint: ComplaintRow): number | null {
  if (!complaint.resolvedAt || !complaint.slaStartedAt) return null;
  const elapsedMs =
    new Date(complaint.resolvedAt).getTime() - new Date(complaint.slaStartedAt).getTime();
  return elapsedMs / 3600000 - complaint.slaPausedSeconds / 3600;
}

/**
 * Mean {@link resolutionHours} over a sample, or **null** — never 0 — when the
 * sample is empty, so "nothing resolved yet" can't be misread as "resolved
 * instantly". Complaints not in the sample are skipped, not counted as zero.
 */
export function avgResolutionHours(complaints: ComplaintRow[]): number | null {
  const durations = complaints
    .map(resolutionHours)
    .filter((h): h is number => h !== null);
  if (durations.length === 0) return null;
  return durations.reduce((sum, h) => sum + h, 0) / durations.length;
}
