import i18n from "@/i18n";

export function timeOfDayGreeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return i18n.t("greeting.morning");
  if (hour < 17) return i18n.t("greeting.afternoon");
  return i18n.t("greeting.evening");
}

// Formatters are cached per locale: constructing an Intl formatter is the
// expensive part, and these run on every dashboard render.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(): Intl.DateTimeFormat {
  const locale = i18n.resolvedLanguage ?? "en";
  let formatter = dateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    dateFormatters.set(locale, formatter);
  }
  return formatter;
}

export function formatFullDate(now: Date = new Date()): string {
  return dateFormatter().format(now);
}
