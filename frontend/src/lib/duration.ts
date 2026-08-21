import i18n from "@/i18n";
import type { StatusHistoryEntry } from "@/types/api";

/** "3d 4h", "5h 12m", "42m" — always the two most significant units, never seconds. */
export function formatDuration(ms: number): string {
  if (ms <= 0) return i18n.t("duration.zero");
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0
      ? i18n.t("duration.daysHours", { days, hours })
      : i18n.t("duration.days", { days });
  }
  if (hours > 0) {
    return minutes > 0
      ? i18n.t("duration.hoursMinutes", { hours, minutes })
      : i18n.t("duration.hours", { hours });
  }
  return i18n.t("duration.minutes", { minutes });
}

export interface StageDuration {
  status: StatusHistoryEntry["toStatus"];
  enteredAt: string;
  /** Null for the current (still-open) stage. */
  leftAt: string | null;
  durationMs: number;
}

/**
 * Diffs consecutive `statusHistory` timestamps into a per-stage duration —
 * "how long did this complaint spend in UNDER_REVIEW". The last entry's
 * stage is still open, so its duration runs to `now`. History is assumed
 * sorted oldest-first (as every list/detail endpoint returns it); this
 * re-sorts defensively since nothing guarantees callers pass it that way.
 */
export function computeStageDurations(
  history: StatusHistoryEntry[],
  now: Date = new Date(),
): StageDuration[] {
  const sorted = [...history].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  return sorted.map((entry, i) => {
    const next = sorted[i + 1];
    const enteredAt = entry.timestamp;
    const leftAt = next ? next.timestamp : null;
    const endMs = next ? new Date(next.timestamp).getTime() : now.getTime();
    return {
      status: entry.toStatus,
      enteredAt,
      leftAt,
      durationMs: Math.max(0, endMs - new Date(enteredAt).getTime()),
    };
  });
}
