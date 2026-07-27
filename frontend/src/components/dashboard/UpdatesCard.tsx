import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { StatusPill } from "@/components/ui/pills";
import { relativeTime } from "@/lib/datetime";
import { updateMessage, type ComplaintUpdate } from "@/lib/complaintUpdates";

const MAX_SHOWN = 5;

/**
 * "Here's what moved while you were away." The list comes from a local diff
 * of `/complaints/my` against the last snapshot this browser saw — see
 * `useComplaintUpdates`. It stays put until dismissed, so an update can't be
 * missed by loading the page while distracted.
 */
export function UpdatesCard({
  updates,
  onDismiss,
}: {
  updates: ComplaintUpdate[];
  onDismiss: () => void;
}) {
  if (updates.length === 0) return null;
  const shown = updates.slice(0, MAX_SHOWN);
  const overflow = updates.length - shown.length;

  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="border-brand/30 from-brand/8 overflow-hidden rounded-lg border bg-gradient-to-br via-surface to-surface"
      aria-label="Updates since your last visit"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="text-brand size-5" aria-hidden="true" />
          <h2 className="font-display text-base font-semibold text-ink">
            {updates.length === 1
              ? "1 update since you were last here"
              : `${updates.length} updates since you were last here`}
          </h2>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-ink-muted hover:bg-surface-hover hover:text-ink inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
        >
          <Check className="size-3.5" aria-hidden="true" />
          Mark all as seen
        </button>
      </div>

      <ul className="divide-y divide-line border-t border-line">
        {shown.map((update) => (
          <li key={update.key}>
            <Link
              to={update.href}
              className="hover:bg-surface-hover group flex items-center gap-3 px-5 py-3 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{updateMessage(update)}</p>
                <p className="text-ink-faint mt-0.5 font-mono text-xs">
                  {update.complaintId} · {relativeTime(update.at)}
                </p>
              </div>
              <StatusPill status={update.to} className="hidden shrink-0 sm:inline-flex" />
              <ArrowRight
                className="text-ink-faint size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>

      {overflow > 0 && (
        <p className="text-ink-faint border-t border-line px-5 py-2 text-xs">
          and {overflow} more — see My Complaints for the full picture.
        </p>
      )}
    </motion.section>
  );
}
