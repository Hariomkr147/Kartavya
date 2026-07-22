import { StatusTimeline } from "./StatusTimeline";
import { relativeTime } from "@/lib/datetime";
import type { ProgressNote, Role, StatusHistoryEntry } from "@/types/api";

export interface TimelineSidebarProps {
  statusHistory?: StatusHistoryEntry[];
  progressNotes?: ProgressNote[];
  notesTitle?: string;
  viewerRole?: Role;
  viewerOfficerId?: string;
}

/**
 * The status-history + progress-notes pairing shared by every complaint
 * detail page (citizen/officer/admin) — pulled out so it can live in a
 * sticky sidebar next to the main content instead of trailing at the very
 * bottom of a long single column.
 */
export function TimelineSidebar({
  statusHistory,
  progressNotes,
  notesTitle = "Progress notes",
  viewerRole,
  viewerOfficerId,
}: TimelineSidebarProps) {
  return (
    <div className="space-y-6">
      {statusHistory && statusHistory.length > 0 && (
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="font-display mb-4 text-base font-semibold text-ink">
            Status history
          </h2>
          <StatusTimeline
            entries={statusHistory}
            viewerRole={viewerRole}
            viewerOfficerId={viewerOfficerId}
          />
        </section>
      )}

      {progressNotes && progressNotes.length > 0 && (
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="font-display mb-3 text-base font-semibold text-ink">
            {notesTitle}
          </h2>
          <div className="space-y-3">
            {progressNotes.map((note) => (
              <div key={note.id} className="bg-surface-hover rounded-md p-3">
                <p className="text-sm text-ink">{note.text}</p>
                <p className="text-ink-faint mt-1 text-xs">
                  Officer #{note.officerId} · {relativeTime(note.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
