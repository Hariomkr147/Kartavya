import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepperProps {
  steps: string[];
  currentStep: number;
  className?: string;
}

/** Bespoke step-progress header for multi-step ("one question at a time") flows. */
export function Stepper({ steps, currentStep, className }: StepperProps) {
  const { t } = useTranslation();

  return (
    <ol
      className={cn("flex items-center gap-2", className)}
      aria-label={t("stepper.progress")}
    >
      {steps.map((label, index) => {
        const status =
          index < currentStep ? "done" : index === currentStep ? "current" : "upcoming";
        return (
          <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
            <div className="flex items-center gap-2">
              <span
                aria-current={status === "current" ? "step" : undefined}
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  status === "done" && "bg-brand text-brand-fg",
                  status === "current" && "border-brand text-brand border-2",
                  status === "upcoming" && "border-line text-ink-faint border-2",
                )}
              >
                {status === "done" ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={cn(
                  "hidden text-sm font-medium sm:inline",
                  status === "upcoming" ? "text-ink-faint" : "text-ink",
                )}
              >
                {label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  "h-px flex-1",
                  status === "done" ? "bg-brand" : "bg-line",
                )}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
