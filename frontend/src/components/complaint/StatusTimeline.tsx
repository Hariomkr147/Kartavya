import { useTranslation } from "react-i18next";
import { ArrowRight, Bot, MessageSquare, Shield, User, UserCog } from "lucide-react";
import { StatusPill } from "@/components/ui/pills";
import { absoluteDateTime, relativeTime } from "@/lib/datetime";
import { computeStageDurations, formatDuration } from "@/lib/duration";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/i18n";
import type { ProgressNote, Role, StatusActor, StatusHistoryEntry } from "@/types/api";

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
const ACTOR_LABEL_KEYS: Record<StatusActor, TranslationKey> = {
  CITIZEN: "roles.citizen",
  OFFICER: "roles.officer",
  ADMIN: "roles.admin",
  SYSTEM: "roles.system",
};

type TimelineItem =
  | { kind: "status"; timestamp: string; entry: StatusHistoryEntry }
  | { kind: "note"; timestamp: string; note: ProgressNote };

export function StatusTimeline({
  entries,
  progressNotes,
  viewerRole,
  viewerOfficerId,
  officerLabel,
}: {
  entries: StatusHistoryEntry[];
  /** Interleaved into the timeline by timestamp, between the status pills they were posted around — status_history and progress notes stay separate append-only sources, only merged here for display. */
  progressNotes?: ProgressNote[];
  /** Whose viewpoint the "You" label is relative to. Defaults to CITIZEN (the original use). */
  viewerRole?: Role;
  /** Required to spot "You" among OFFICER entries — a zone can have entries from more than one officer over time. */
  viewerOfficerId?: string;
  /**
   * Resolves an officer id to a display label. Defaults to "Officer #7" —
   * which is what citizens and officers must keep seeing. Only the admin
   * pages pass a resolver that returns real names.
   */
  officerLabel?: (officerId: string) => string;
}) {
  const { t } = useTranslation();
  const labelForOfficer = officerLabel ?? ((id: string) => `Officer #${id}`);
  const items: TimelineItem[] = [
    ...entries.map((entry): TimelineItem => ({
      kind: "status",
      timestamp: entry.timestamp,
      entry,
    })),
    ...(progressNotes ?? []).map((note): TimelineItem => ({
      kind: "note",
      timestamp: note.createdAt,
      note,
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const firstStatusIndex = items.findIndex((item) => item.kind === "status");

  // Chronological (oldest-first) pass just to derive, per entry, how long the
  // complaint spent in the *previous* stage before this transition — the
  // display list above stays newest-first, so this is a separate lookup by
  // entry id rather than reusing that order.
  const chronological = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const stageDurations = computeStageDurations(chronological);
  const previousStageDurationMs = new Map<string, number>();
  chronological.forEach((entry, i) => {
    if (i > 0) previousStageDurationMs.set(entry.id, stageDurations[i - 1].durationMs);
  });

  return (
    <ol className="space-y-0">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const connector = !isLast && (
          <span
            className="bg-line absolute top-7 left-3.5 h-full w-px"
            aria-hidden="true"
          />
        );

        if (item.kind === "note") {
          const { note } = item;
          return (
            <li key={`note-${note.id}`} className="relative flex gap-3 pb-6 last:pb-0">
              {connector}
              <span className="bg-surface-hover text-ink-muted relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full">
                <MessageSquare className="size-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="bg-surface-hover rounded-md p-3">
                  <p className="text-sm text-ink">{note.text}</p>
                  <p
                    className="text-ink-faint mt-1 text-xs"
                    title={absoluteDateTime(note.createdAt)}
                  >
                    {labelForOfficer(note.officerId)} · {relativeTime(note.createdAt)}
                  </p>
                </div>
              </div>
            </li>
          );
        }

        const { entry } = item;
        const Icon = ACTOR_ICON[entry.changedByRole];
        const isViewer =
          entry.changedByRole === (viewerRole ?? "CITIZEN") &&
          (entry.changedByRole !== "OFFICER" ||
            entry.changedByOfficerId === viewerOfficerId);
        const actorLabel = isViewer
          ? t("statusTimeline.you")
          : entry.changedByOfficerId
            ? labelForOfficer(entry.changedByOfficerId)
            : t(ACTOR_LABEL_KEYS[entry.changedByRole]);
        const isCurrent = i === firstStatusIndex;
        return (
          <li key={entry.id} className="relative flex gap-3 pb-6 last:pb-0">
            {connector}
            <span
              className={cn(
                "relative z-10 flex shrink-0 items-center justify-center rounded-full",
                isCurrent
                  ? "bg-brand text-brand-fg ring-brand-subtle size-8 ring-4"
                  : "bg-surface-hover text-ink-muted size-7",
              )}
            >
              <Icon className={isCurrent ? "size-4" : "size-3.5"} aria-hidden="true" />
            </span>
            <div className={cn("min-w-0 flex-1", isCurrent ? "pt-1" : "pt-0.5")}>
              <div className="flex flex-wrap items-center gap-2">
                {entry.fromStatus && (
                  <>
                    <span className="text-ink-faint text-xs">
                      {t(`status.${entry.fromStatus}`)}
                    </span>
                    <ArrowRight
                      className="text-ink-faint size-3 shrink-0"
                      aria-hidden="true"
                    />
                  </>
                )}
                <StatusPill
                  status={entry.toStatus}
                  className={isCurrent ? "text-sm" : undefined}
                />
                {isCurrent && (
                  <span className="text-brand text-[11px] font-semibold tracking-wide uppercase">
                    {t("statusTimeline.current")}
                  </span>
                )}
                <span className="text-ink-faint text-xs">
                  {t("statusTimeline.by", { actor: actorLabel })}
                </span>
                <span
                  className="text-ink-faint text-xs"
                  title={absoluteDateTime(entry.timestamp)}
                >
                  · {relativeTime(entry.timestamp)}
                </span>
              </div>
              {entry.fromStatus && previousStageDurationMs.has(entry.id) && (
                <p className="text-ink-faint mt-1 text-xs">
                  {t("statusTimeline.spent", {
                    duration: formatDuration(previousStageDurationMs.get(entry.id)!),
                    status: t(`status.${entry.fromStatus}`),
                  })}
                </p>
              )}
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
