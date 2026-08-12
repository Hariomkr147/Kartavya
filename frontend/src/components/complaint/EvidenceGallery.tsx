import { useState, type ReactNode } from "react";
import {
  Bot,
  BotOff,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  UserCog,
  ZoomIn,
} from "lucide-react";
import { Lightbox } from "@/components/ui/Lightbox";
import { PhotoThumb } from "@/components/ui/PhotoThumb";
import { relativeTime, absoluteDateTime } from "@/lib/datetime";
import { screeningPhase } from "@/lib/aiScreening";
import { cn } from "@/lib/utils";
import type { Evidence, EvidenceVerdict } from "@/types/api";

const VERDICT_CONFIG: Record<
  EvidenceVerdict,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  VALID: { label: "Accepted", icon: CheckCircle2, className: "text-status-resolved" },
  NEEDS_MORE_EVIDENCE: {
    label: "Needed more evidence",
    icon: AlertTriangle,
    className: "text-status-needs_more_evidence",
  },
  REJECTED: { label: "Rejected", icon: XCircle, className: "text-status-rejected" },
};

/**
 * The screening badge is deliberately qualitative.
 *
 * A percentage reads as a measurement of whether the complaint is genuine,
 * which is not what the model produces and not what anyone should act on: the
 * officer's evidence-review verdict is the decision, and the AI note is
 * advisory only. Alpha testers consistently read "58% match" as "this report
 * is 58% likely to be real" and argued with it. `matchesCategory` is the one
 * bit that is actually actionable — does the photo look like the category the
 * citizen picked — so that is all this shows.
 */
function screeningBadge(note: {
  matchesCategory?: boolean | null;
}): { label: string; className: string } {
  if (note.matchesCategory === true) {
    return {
      label: "Matches category",
      className: "bg-status-resolved-subtle text-status-resolved",
    };
  }
  if (note.matchesCategory === false) {
    return {
      label: "Possible mismatch",
      className:
        "bg-status-needs_more_evidence-subtle text-status-needs_more_evidence",
    };
  }
  return { label: "AI reviewed", className: "bg-surface-hover text-ink-muted" };
}

/**
 * Same three phases the thumbnail badges above show, spelled out in full for
 * the lightbox's caption area — text-white/70 rather than the card's
 * text-ink-faint since this renders over the lightbox's dark overlay, not
 * the page surface.
 */
function aiScreeningDescription(item: Evidence): ReactNode {
  const phase = item.aiConfidenceNote ? screeningPhase(item.aiConfidenceNote) : null;
  if (phase === "pending") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-white/70">
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
        Analyzing photo {item.sequence}…
      </span>
    );
  }
  if (phase === "done" && item.aiConfidenceNote) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-white/70">
        <Bot className="size-3.5 shrink-0" aria-hidden="true" />
        {item.aiConfidenceNote.note}
      </span>
    );
  }
  if (phase === "unavailable") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-white/70">
        <BotOff className="size-3.5 shrink-0" aria-hidden="true" />
        AI screening was unavailable — an officer will review it directly.
      </span>
    );
  }
  return undefined;
}

export function EvidenceGallery({
  evidence,
  officerLabel,
}: {
  evidence: Evidence[];
  /** See StatusTimeline — admin-only name resolution, "Officer #7" otherwise. */
  officerLabel?: (officerId: string) => string;
}) {
  const labelForOfficer = officerLabel ?? ((id: string) => `Officer #${id}`);
  const sorted = [...evidence].sort((a, b) => a.sequence - b.sequence);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const lightboxImages = sorted.map((item) => ({
    src: item.photoUrl,
    alt: `Evidence photo ${item.sequence}`,
    caption: `Photo #${item.sequence} · submitted ${absoluteDateTime(item.submittedAt)}`,
    description: aiScreeningDescription(item),
  }));

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {sorted.map((item, index) => {
        const verdict = item.verdict ? VERDICT_CONFIG[item.verdict] : null;
        const phase = item.aiConfidenceNote
          ? screeningPhase(item.aiConfidenceNote)
          : null;
        return (
          <div key={item.id} className="overflow-hidden rounded-lg border border-line">
            <button
              type="button"
              onClick={() => setLightboxIndex(index)}
              aria-label={`View photo ${item.sequence} full-size`}
              className="group relative block w-full"
            >
              <PhotoThumb
                src={item.photoUrl}
                alt={`Evidence photo ${item.sequence}`}
                className="h-48 w-full object-cover"
                iconClassName="text-ink-faint size-8"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100 focus-visible:opacity-100">
                <ZoomIn className="size-6 text-white" aria-hidden="true" />
              </span>
              {phase === "done" && item.aiConfidenceNote && (
                <span
                  className={cn(
                    "absolute top-2 right-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm",
                    screeningBadge(item.aiConfidenceNote).className,
                  )}
                >
                  <Bot className="size-3.5 shrink-0" aria-hidden="true" />
                  {screeningBadge(item.aiConfidenceNote).label}
                </span>
              )}
              {phase === "pending" && (
                <span className="bg-surface/90 text-ink-muted absolute top-2 right-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium shadow-sm">
                  <Loader2
                    className="size-3.5 shrink-0 animate-spin"
                    aria-hidden="true"
                  />
                  Analyzing…
                </span>
              )}
              {phase === "unavailable" && (
                <span className="bg-surface/90 text-ink-muted absolute top-2 right-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium shadow-sm">
                  <BotOff className="size-3.5 shrink-0" aria-hidden="true" />
                  AI unavailable
                </span>
              )}
            </button>
            <div className="space-y-2 p-3">
              <div className="flex items-center justify-between">
                <span className="text-ink-faint text-xs font-medium">
                  Photo #{item.sequence} · {relativeTime(item.submittedAt)}
                </span>
                {verdict && (
                  <span
                    className={cn(
                      "flex items-center gap-1 text-xs font-medium",
                      verdict.className,
                    )}
                  >
                    <verdict.icon className="size-3.5" aria-hidden="true" />
                    {verdict.label}
                  </span>
                )}
              </div>
              {item.verdictReason && (
                <p className="text-ink-muted text-xs">{item.verdictReason}</p>
              )}
              {phase === "done" && item.aiConfidenceNote && (
                <p className="text-ink-faint text-xs">{item.aiConfidenceNote.note}</p>
              )}
              {phase === "unavailable" && (
                <p className="text-ink-faint text-xs">
                  AI screening was unavailable for this photo — an officer will review it
                  directly.
                </p>
              )}
              {item.reviewedByOfficerId && (
                <p
                  className="text-ink-faint flex items-center gap-1 text-xs"
                  title={item.reviewedAt ? absoluteDateTime(item.reviewedAt) : undefined}
                >
                  <UserCog className="size-3.5 shrink-0" aria-hidden="true" />
                  Reviewed by {labelForOfficer(item.reviewedByOfficerId)}
                  {item.reviewedAt && ` · ${relativeTime(item.reviewedAt)}`}
                </p>
              )}
            </div>
          </div>
        );
      })}
      <Lightbox
        images={lightboxImages}
        openIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />
    </div>
  );
}
