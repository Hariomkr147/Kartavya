import { Clock } from "lucide-react";
import { StatusTimeline } from "./StatusTimeline";
import { formatDuration } from "@/lib/duration";
import { computeSlaProgress } from "@/lib/slaProgress";
import { cn } from "@/lib/utils";
import type { ProgressNote, Role, StatusHistoryEntry } from "@/types/api";

export interface TimelineSidebarProps {
  statusHistory?: StatusHistoryEntry[];
  progressNotes?: ProgressNote[];
  viewerRole?: Role;
  viewerOfficerId?: string;
  /** When present (and the complaint has reached UNDER_REVIEW), renders an approximate SLA progress bar above the timeline — visual only, the complaint's own `slaLabel` pill elsewhere on the page remains the authoritative on-time/delayed/overdue read. */
  slaTargetHours?: number | null;
  /** See StatusTimeline — admin-only officer name resolution. */
  officerLabel?: (officerId: string) => string;
}

/**
 * The status-history + progress-notes pairing shared by every complaint
 * detail page (citizen/officer/admin) — pulled out so it can live in a
 * sticky sidebar next to the main content instead of trailing at the very
 * bottom of a long single column. Notes are interleaved into the status
 * timeline by StatusTimeline itself so readers can see roughly when each
 * note was posted relative to the complaint's status changes.
 */
export function TimelineSidebar({
  statusHistory,
  progressNotes,
  viewerRole,
  viewerOfficerId,
  slaTargetHours,
  officerLabel,
}: TimelineSidebarProps) {
  if (!statusHistory || statusHistory.length === 0) return null;

  const slaProgress = computeSlaProgress(statusHistory, slaTargetHours);

  return (
    <div className="space-y-4">
      {slaProgress && (
        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="mb-2 flex items-center gap-2">
            <Clock className="text-ink-muted size-4" aria-hidden="true" />
            <h2 className="font-display text-sm font-semibold text-ink">SLA progress</h2>
          </div>
          <div className="bg-surface-hover h-2 w-full overflow-hidden rounded-full">
            <div
              className={cn(
                "h-full rounded-full transition-[width]",
                slaProgress.isOverdue ? "bg-sla-overdue" : "bg-brand",
              )}
              style={{ width: `${Math.min(100, slaProgress.percentUsed)}%` }}
            />
          </div>
          <p className="text-ink-faint mt-2 text-xs">
            {slaProgress.isOverdue
              ? `${formatDuration(Math.abs(slaProgress.msRemaining))} over the target`
              : `${formatDuration(slaProgress.msRemaining)} remaining · ${Math.round(slaProgress.percentUsed)}% of target used`}
          </p>
        </section>
      )}
      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="font-display mb-4 text-base font-semibold text-ink">
          Status history
        </h2>
        <StatusTimeline
          entries={statusHistory}
          progressNotes={progressNotes}
          viewerRole={viewerRole}
          viewerOfficerId={viewerOfficerId}
          officerLabel={officerLabel}
        />
      </section>
    </div>
  );
}
