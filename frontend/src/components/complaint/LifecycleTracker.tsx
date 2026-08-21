import { useTranslation } from "react-i18next";
import { Check, CircleDashed, Loader2, TriangleAlert, X } from "lucide-react";
import { motion } from "framer-motion";
import { describeLifecycle, type StageState } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";
import type { ComplaintStatus } from "@/types/api";

const NODE_CLASSES: Record<StageState, string> = {
  done: "border-transparent bg-brand text-brand-fg",
  current: "border-brand bg-brand text-brand-fg",
  attention: "border-transparent bg-status-needs_more_evidence text-white",
  stopped: "border-transparent bg-status-rejected text-white",
  upcoming: "border-line bg-surface text-ink-faint",
  cancelled: "border-line bg-surface text-ink-faint opacity-50",
};

const LABEL_CLASSES: Record<StageState, string> = {
  done: "text-ink-muted",
  current: "text-ink font-semibold",
  attention: "text-ink font-semibold",
  stopped: "text-ink font-semibold",
  upcoming: "text-ink-faint",
  cancelled: "text-ink-faint line-through opacity-60",
};

const CONNECTOR_CLASSES: Record<StageState, string> = {
  done: "bg-brand",
  current: "bg-brand",
  attention: "bg-status-needs_more_evidence",
  stopped: "bg-status-rejected",
  upcoming: "bg-line",
  cancelled: "bg-line",
};

const RING_CLASSES: Partial<Record<StageState, string>> = {
  current: "ring-brand-subtle ring-4",
  attention: "ring-status-needs_more_evidence-subtle ring-4",
  stopped: "ring-status-rejected-subtle ring-4",
};

const DETOUR_CLASSES = {
  warning:
    "border-status-needs_more_evidence/30 bg-status-needs_more_evidence-subtle text-status-needs_more_evidence",
  bad: "border-status-rejected/30 bg-status-rejected-subtle text-status-rejected",
} as const;

function StageIcon({ state }: { state: StageState }) {
  if (state === "done") return <Check className="size-4" aria-hidden="true" />;
  if (state === "attention")
    return <TriangleAlert className="size-4" aria-hidden="true" />;
  if (state === "current")
    return <Loader2 className="size-4 animate-spin" aria-hidden="true" />;
  if (state === "stopped") return <X className="size-4" aria-hidden="true" />;
  if (state === "cancelled") return <X className="size-3.5" aria-hidden="true" />;
  return <CircleDashed className="size-3.5" aria-hidden="true" />;
}

/**
 * The forward-looking companion to `StatusTimeline`. The timeline is an
 * audit trail of where a complaint has *been*; this collapses the contract's
 * eleven statuses into the six stages it passes through so a citizen can see
 * where it is going and what is left — the question the history alone never
 * answers. Derived per `describeLifecycle`, stored nowhere.
 */
export function LifecycleTracker({
  status,
  className,
}: {
  status: ComplaintStatus;
  className?: string;
}) {
  const { t } = useTranslation();
  const { stages, currentIndex, detour } = describeLifecycle(status);
  const current = stages[currentIndex];

  return (
    <section
      className={cn("rounded-lg border border-line bg-surface p-5", className)}
      aria-label={t("lifecycleTracker.label")}
    >
      <ol className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-0">
        {stages.map((stage, index) => {
          const isLast = index === stages.length - 1;
          // The connector leading *out* of a node takes the colour of the
          // segment already travelled, so the filled run stops exactly where
          // the complaint currently sits.
          const connectorState = index < currentIndex ? stages[index].state : "upcoming";
          return (
            <li
              key={stage.key}
              className="flex gap-3 sm:min-w-0 sm:flex-1 sm:flex-col sm:gap-2"
              aria-current={index === currentIndex ? "step" : undefined}
            >
              <div className="flex flex-col items-center sm:w-full sm:flex-row">
                <motion.span
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: index * 0.05, duration: 0.25 }}
                  className={cn(
                    "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2",
                    NODE_CLASSES[stage.state],
                    index === currentIndex && RING_CLASSES[stage.state],
                  )}
                >
                  <StageIcon state={stage.state} />
                </motion.span>
                {!isLast && (
                  <span
                    className={cn(
                      "w-0.5 flex-1 sm:h-0.5 sm:w-auto",
                      "min-h-4 sm:min-h-0",
                      CONNECTOR_CLASSES[connectorState],
                    )}
                    aria-hidden="true"
                  />
                )}
              </div>
              <div className="min-w-0 pb-1 sm:pr-4">
                <p className={cn("text-sm leading-tight", LABEL_CLASSES[stage.state])}>
                  {stage.label}
                </p>
                {index === currentIndex && (
                  <p className="text-ink-muted mt-1 text-xs leading-snug">{stage.hint}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {detour && (
        <p
          className={cn(
            "mt-4 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
            DETOUR_CLASSES[detour.tone],
          )}
        >
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          {detour.label}
        </p>
      )}

      <p className="sr-only">
        {current
          ? t("lifecycleTracker.srStatus", {
              step: currentIndex + 1,
              total: stages.length,
              label: current.label,
              hint: current.hint,
            })
          : ""}
      </p>
    </section>
  );
}
