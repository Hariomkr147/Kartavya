import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  hint?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, hint, leftIcon, rightIcon, id, ...props }, ref) => {
    const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
    return (
      <div>
        <div className="relative">
          {leftIcon && (
            <span className="text-ink-faint pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={id}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className={cn(
              "h-11 w-full rounded-md border bg-surface px-3 text-sm text-ink placeholder:text-ink-faint transition-colors",
              "border-line focus-visible:border-brand focus-visible:outline-none",
              error && "border-status-rejected focus-visible:border-status-rejected",
              leftIcon && "pl-9",
              rightIcon && "pr-9",
              "disabled:cursor-not-allowed disabled:opacity-50",
              className,
            )}
            {...props}
          />
          {rightIcon && (
            <span className="text-ink-faint absolute top-1/2 right-3 -translate-y-1/2">
              {rightIcon}
            </span>
          )}
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
Input.displayName = "Input";
