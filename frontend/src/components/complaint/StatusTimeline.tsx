import { Bot, Shield, User, UserCog } from "lucide-react";
import { StatusPill } from "@/components/ui/pills";
import { absoluteDateTime, relativeTime } from "@/lib/datetime";
import type { Role, StatusActor, StatusHistoryEntry } from "@/types/api";

const ACTOR_ICON: Record<StatusActor, typeof User> = {
  CITIZEN: User,
  OFFICER: UserCog,
  ADMIN: Shield,
  SYSTEM: Bot,
};

// "You" only makes sense from the actor's own role's viewpoint (e.g. a
// citizen reading their own history) — an officer or admin viewing the same
// entries must still see "Citizen"/"Admin", never be told an action they
// didn't take was theirs.
const ACTOR_LABEL: Record<StatusActor, string> = {
  CITIZEN: "Citizen",
  OFFICER: "Officer",
  ADMIN: "Admin",
  SYSTEM: "System",
};

export function StatusTimeline({
  entries,
  viewerRole,
  viewerOfficerId,
}: {
  entries: StatusHistoryEntry[];
  /** Whose viewpoint the "You" label is relative to. Defaults to CITIZEN (the original use). */
  viewerRole?: Role;
  /** Required to spot "You" among OFFICER entries — a zone can have entries from more than one officer over time. */
  viewerOfficerId?: string;
}) {
  const sorted = [...entries].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return (
    <ol className="space-y-0">
      {sorted.map((entry, i) => {
        const Icon = ACTOR_ICON[entry.changedByRole];
        const isViewer =
          entry.changedByRole === (viewerRole ?? "CITIZEN") &&
          (entry.changedByRole !== "OFFICER" || entry.changedByOfficerId === viewerOfficerId);
        const actorLabel = isViewer
          ? "You"
          : entry.changedByOfficerId
            ? `Officer #${entry.changedByOfficerId}`
            : ACTOR_LABEL[entry.changedByRole];
        return (
          <li key={entry.id} className="relative flex gap-3 pb-6 last:pb-0">
            {i < sorted.length - 1 && (
              <span
                className="bg-line absolute top-7 left-3.5 h-full w-px"
                aria-hidden="true"
              />
            )}
            <span className="bg-surface-hover text-ink-muted relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full">
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={entry.toStatus} />
                <span className="text-ink-faint text-xs">by {actorLabel}</span>
                <span
                  className="text-ink-faint text-xs"
                  title={absoluteDateTime(entry.timestamp)}
                >
                  · {relativeTime(entry.timestamp)}
                </span>
              </div>
              {entry.reason && <p className="text-ink mt-1 text-sm">{entry.reason}</p>}
              {entry.remark && (
                <p className="text-ink-muted mt-1 text-sm">{entry.remark}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
