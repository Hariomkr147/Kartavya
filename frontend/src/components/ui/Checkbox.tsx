import { forwardRef, type InputHTMLAttributes } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  label?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, id, ...props }, ref) => {
    const input = (
      <span className="relative inline-flex size-5 shrink-0 items-center justify-center">
        <input
          ref={ref}
          type="checkbox"
          id={id}
          className={cn(
            "peer size-5 shrink-0 appearance-none rounded border border-line-strong bg-surface transition-colors",
            "checked:border-brand checked:bg-brand",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        />
        <Check
          className="pointer-events-none absolute size-3.5 text-brand-fg opacity-0 peer-checked:opacity-100"
          aria-hidden="true"
          strokeWidth={3}
        />
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
