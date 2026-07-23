import type { SlaLabel } from "../db/types";

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
