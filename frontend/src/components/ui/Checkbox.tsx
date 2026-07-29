import { forwardRef, useEffect, useRef, type InputHTMLAttributes } from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  label?: string;
  /**
   * "Some, not all, of what this checkbox summarizes are selected" — e.g. a
   * table's select-all header when only some rows on the page are ticked.
   * Only settable via the DOM property, never an HTML attribute, so it's
   * applied imperatively through a ref rather than as JSX on `<input>`.
   */
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, id, indeterminate = false, ...props }, forwardedRef) => {
    const innerRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = indeterminate;
    }, [indeterminate]);

    function setRefs(node: HTMLInputElement | null) {
      innerRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }

    const input = (
      <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
        <input
          ref={setRefs}
          type="checkbox"
          id={id}
          aria-checked={indeterminate ? "mixed" : props.checked}
          className={cn(
            "peer size-5 shrink-0 appearance-none rounded border border-line-strong bg-surface transition-colors",
            "checked:border-brand checked:bg-brand",
            indeterminate && "border-brand bg-brand",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        />
        {indeterminate ? (
          <Minus
            className="pointer-events-none absolute size-3.5 text-brand-fg"
            aria-hidden="true"
            strokeWidth={3}
          />
        ) : (
          <Check
            className="pointer-events-none absolute size-3.5 text-brand-fg opacity-0 peer-checked:opacity-100"
            aria-hidden="true"
            strokeWidth={3}
          />
        )}
      </span>
    );

    if (!label) return input;

    return (
      <label
        htmlFor={id}
        className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink"
      >
        {input}
        {label}
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";
