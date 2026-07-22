import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { staggerItem } from "@/lib/motionVariants";
import { AnimatedNumber } from "./AnimatedNumber";

export type StatCardAccent = "brand" | "good" | "warning" | "bad" | "csp";

const ACCENT_CLASSES: Record<StatCardAccent, { icon: string; chip: string }> = {
  brand: { icon: "text-brand", chip: "bg-brand/10" },
  good: { icon: "text-status-resolved", chip: "bg-status-resolved-subtle" },
  warning: {
    icon: "text-status-needs_more_evidence",
    chip: "bg-status-needs_more_evidence-subtle",
  },
  bad: { icon: "text-sla-overdue", chip: "bg-sla-overdue-subtle" },
  csp: { icon: "text-csp", chip: "bg-csp/15" },
};

export interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: number | string;
  accent?: StatCardAccent;
  format?: (n: number) => string;
  className?: string;
}

/**
 * Shared stat tile for every dashboard (citizen/officer/admin) — an icon
 * chip, an animated count-up value (skipped for string values like "149h"),
 * and a hover lift. Meant to sit inside a `motion.div` with
 * `variants={staggerContainer}` so a whole tile grid reveals in sequence.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  accent = "brand",
  format,
  className,
}: StatCardProps) {
  const accentClasses = ACCENT_CLASSES[accent];
  return (
    <motion.div
      variants={staggerItem}
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={cn(
        "rounded-lg border border-line bg-surface p-5 shadow-xs transition-shadow duration-200 hover:shadow-md",
        className,
      )}
    >
      <span
        className={cn(
          "mb-3 flex size-10 items-center justify-center rounded-full",
          accentClasses.chip,
        )}
      >
        <Icon className={cn("size-5", accentClasses.icon)} aria-hidden="true" />
      </span>
      <p className="text-ink-muted text-sm font-medium">{label}</p>
      <p className={cn("mt-1.5 font-mono text-3xl font-semibold", accentClasses.icon)}>
        {typeof value === "number" ? (
          <AnimatedNumber value={value} format={format} />
        ) : (
          value
        )}
      </p>
    </motion.div>
  );
}
