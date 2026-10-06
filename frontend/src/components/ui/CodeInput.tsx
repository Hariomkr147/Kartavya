import { forwardRef, type ChangeEvent, type InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

interface CodeInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value" | "type"
> {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

/**
 * A 6-digit one-time code. `autocomplete="one-time-code"` lets a phone offer the
 * code from a message or password manager; digits only, so a pasted "123 456"
 * still works.
 */
export const CodeInput = forwardRef<HTMLInputElement, CodeInputProps>(
  ({ value, onChange, className, ...props }, ref) => {
    function handle(event: ChangeEvent<HTMLInputElement>) {
      onChange(event.target.value.replace(/\D/g, "").slice(0, 6));
    }
    return (
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        value={value}
        onChange={handle}
        className={cn("font-mono text-lg tracking-[0.4em]", className)}
        {...props}
      />
    );
  },
);
CodeInput.displayName = "CodeInput";
