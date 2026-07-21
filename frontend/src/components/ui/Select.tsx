import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  hint?: string;
}

/**
 * Styled wrapper around the native <select>, not a custom listbox — native
 * selects already give correct keyboard/touch/screen-reader behavior for
 * free, and every use in this app is a plain option-pick (category, zone,
 * status filter), not a searchable combobox.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, hint, id, children, ...props }, ref) => {
    const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
    return (
      <div>
        <div className="relative">
          <select
            ref={ref}
            id={id}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className={cn(
              "h-11 w-full appearance-none rounded-md border bg-surface px-3 pr-9 text-sm text-ink transition-colors",
              "border-line focus-visible:border-brand focus-visible:outline-none",
              error && "border-status-rejected focus-visible:border-status-rejected",
              "disabled:cursor-not-allowed disabled:opacity-50",
              className,
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown
            className="text-ink-faint pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
        </div>
        {error ? (
          <p id={`${id}-error`} className="text-status-rejected mt-1.5 text-xs">
            {error}
          </p>
        ) : hint ? (
          <p id={`${id}-hint`} className="text-ink-faint mt-1.5 text-xs">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
Select.displayName = "Select";
