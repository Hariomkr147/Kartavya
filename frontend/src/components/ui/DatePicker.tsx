import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useAnchoredPlacement,
  useDismissOnViewportChange,
} from "@/hooks/useAnchoredPlacement";

export interface DatePickerProps {
  value?: Date;
  onChange: (date: Date) => void;
  placeholder?: string;
  minDate?: Date;
  maxDate?: Date;
  className?: string;
  id?: string;
}

/**
 * Weekday initials come from `Intl` rather than a hardcoded English list,
 * so the calendar header is in the reader's script. 2024-01-07 is a Sunday,
 * matching the Sunday-first grid below.
 */
function weekdayLabels(locale: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  return Array.from({ length: 7 }, (_, i) =>
    format.format(new Date(Date.UTC(2024, 0, 7 + i))),
  );
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDate(d: Date, locale: string) {
  return d.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Bespoke calendar popover — single month grid, no date library, no floating-ui dependency. */
export function DatePicker({
  value,
  onChange,
  placeholder,
  minDate,
  maxDate,
  className,
  id,
}: DatePickerProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const weekdays = useMemo(() => weekdayLabels(locale), [locale]);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => value ?? new Date());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const placement = useAnchoredPlacement(open, triggerRect, popoverRef, 0);
  useDismissOnViewportChange(open, popoverRef, () => setOpen(false));

  useEffect(() => {
    if (!open) return;

    const trigger = triggerRef.current;

    function handlePointerDown(e: PointerEvent) {
      if (
        popoverRef.current?.contains(e.target as Node) ||
        trigger?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();

  const cells: (Date | null)[] = [
    ...Array<null>(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];

  const today = startOfDay(new Date());

  function isDisabled(d: Date) {
    if (minDate && d < startOfDay(minDate)) return true;
    if (maxDate && d > startOfDay(maxDate)) return true;
    return false;
  }

  function selectDay(d: Date) {
    if (isDisabled(d)) return;
    onChange(d);
    setOpen(false);
  }

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          setViewMonth(value ?? new Date());
          if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            setTriggerRect(rect);
            setPosition({
              top: rect.bottom + window.scrollY + 4,
              left: rect.left + window.scrollX,
            });
          }
          setOpen(true);
        }}
        className={cn(
          "flex h-11 w-full items-center gap-2 rounded-md border border-line bg-surface px-3 text-left text-sm transition-colors",
          "focus-visible:border-brand focus-visible:outline-none",
          value ? "text-ink" : "text-ink-faint",
        )}
      >
        <CalendarIcon className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
        <span className="flex-1 truncate">
          {value ? formatDate(value, locale) : (placeholder ?? t("datePicker.placeholder"))}
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={t("datePicker.chooseDate")}
            style={{
              position: "absolute",
              top: placement.measured ? placement.top : position.top,
              left: position.left,
              maxHeight: placement.measured ? placement.maxHeight : undefined,
              visibility: placement.measured ? undefined : "hidden",
            }}
            className="animate-in fade-in zoom-in-95 z-50 w-64 overflow-y-auto overscroll-contain rounded-md border border-line bg-surface p-3 shadow-md duration-100"
          >
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label={t("datePicker.previousMonth")}
                onClick={() => setViewMonth(new Date(year, month - 1, 1))}
                className="rounded-md p-1 text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-sm font-medium text-ink">
                {viewMonth.toLocaleDateString(locale, {
                  month: "long",
                  year: "numeric",
                })}
              </span>
              <button
                type="button"
                aria-label={t("datePicker.nextMonth")}
                onClick={() => setViewMonth(new Date(year, month + 1, 1))}
                className="rounded-md p-1 text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {weekdays.map((label, i) => (
                <div
                  key={i}
                  className="flex h-7 items-center justify-center text-xs font-medium text-ink-faint"
                >
                  {label}
                </div>
              ))}
              {cells.map((d, i) =>
                d ? (
                  <button
                    key={i}
                    type="button"
                    disabled={isDisabled(d)}
                    onClick={() => selectDay(d)}
                    aria-pressed={value ? isSameDay(d, value) : false}
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-md text-sm transition-colors",
                      "hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent",
                      value && isSameDay(d, value)
                        ? "bg-brand text-white hover:bg-brand"
                        : isSameDay(d, today)
                          ? "text-brand font-semibold"
                          : "text-ink",
                    )}
                  >
                    {d.getDate()}
                  </button>
                ) : (
                  <div key={i} />
                ),
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
