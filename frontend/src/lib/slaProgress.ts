import type { StatusHistoryEntry } from "@/types/api";

export interface SlaProgress {
  /** When the SLA clock started (first entry that reached UNDER_REVIEW). */
  startedAt: string;
  deadline: Date;
  percentUsed: number;
  msRemaining: number;
  isOverdue: boolean;
}

/**
 * Approximates SLA countdown/progress purely from data already on the
 * complaint: `slaTargetHours` plus the `statusHistory` timestamp where the
 * complaint first reached UNDER_REVIEW (that's when the real SLA clock
 * starts server-side). This is a *visual approximation only* — the API
 * never exposes `sla_paused_seconds`/`sla_paused_at`, so time spent in a
 * later NEEDS_MORE_EVIDENCE recall isn't excluded here the way the server's
 * authoritative `slaLabel` already excludes it. Treat `slaLabel` as ground
 * truth for on-time/delayed/overdue; use this only to render a friendly
 * progress bar or countdown, never to contradict the label.
 */
export function computeSlaProgress(
  history: StatusHistoryEntry[],
  slaTargetHours: number | null | undefined,
  now: Date = new Date(),
): SlaProgress | null {
  if (!slaTargetHours) return null;
  const startEntry = [...history]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .find((entry) => entry.toStatus === "UNDER_REVIEW");
  if (!startEntry) return null;

  const startedAtMs = new Date(startEntry.timestamp).getTime();
  const targetMs = slaTargetHours * 60 * 60 * 1000;
  const deadline = new Date(startedAtMs + targetMs);
  const elapsedMs = now.getTime() - startedAtMs;
  const percentUsed = Math.max(0, (elapsedMs / targetMs) * 100);

  return {
    startedAt: startEntry.timestamp,
    deadline,
    percentUsed,
    msRemaining: deadline.getTime() - now.getTime(),
    isOverdue: percentUsed > 100,
  };
}
