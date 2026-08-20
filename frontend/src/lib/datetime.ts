import i18n from "@/i18n";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

// Cached per locale — see `greeting.ts` for the same pattern; these run on
// every list row.
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();
const absoluteFormatters = new Map<string, Intl.DateTimeFormat>();

function activeLocale(): string {
  return i18n.resolvedLanguage ?? "en";
}

function relativeFormatter(): Intl.RelativeTimeFormat {
  const locale = activeLocale();
  let formatter = relativeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    relativeFormatters.set(locale, formatter);
  }
  return formatter;
}

/** "3 days ago", "2 hours ago", or "just now" for anything under a minute. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const diffSeconds = (new Date(iso).getTime() - now.getTime()) / 1000;
  for (const [unit, secondsInUnit] of UNITS) {
    if (Math.abs(diffSeconds) >= secondsInUnit) {
      return relativeFormatter().format(Math.round(diffSeconds / secondsInUnit), unit);
    }
  }
  return i18n.t("time.justNow");
}

function absoluteFormatter(): Intl.DateTimeFormat {
  const locale = activeLocale();
  let formatter = absoluteFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    absoluteFormatters.set(locale, formatter);
  }
  return formatter;
}

export function absoluteDateTime(iso: string): string {
  return absoluteFormatter().format(new Date(iso));
}
