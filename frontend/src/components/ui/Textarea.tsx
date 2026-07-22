import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, hint, id, rows = 4, ...props }, ref) => {
    const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
    return (
      <div>
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={cn(
            "w-full resize-y rounded-md border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint transition-colors",
            "border-line focus-visible:border-brand focus-visible:outline-none",
            error && "border-status-rejected focus-visible:border-status-rejected",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        />
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
Textarea.displayName = "Textarea";
