const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 days ago", "2 hours ago", or "just now" for anything under a minute. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diffSeconds = (new Date(iso).getTime() - now.getTime()) / 1000;
  for (const [unit, secondsInUnit] of UNITS) {
    if (Math.abs(diffSeconds) >= secondsInUnit) {
      return relativeFormatter.format(Math.round(diffSeconds / secondsInUnit), unit);
    }
  }
  return "just now";
}

const absoluteFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function absoluteDateTime(iso: string): string {
  return absoluteFormatter.format(new Date(iso));
}
