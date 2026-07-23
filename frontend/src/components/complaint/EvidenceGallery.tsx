import { useState } from "react";
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

function confidenceBadgeClass(confidence: number | null | undefined): string {
  if (confidence == null) return "bg-surface-hover text-ink-muted";
  if (confidence >= 0.7) return "bg-status-resolved-subtle text-status-resolved";
  if (confidence >= 0.4)
    return "bg-status-needs_more_evidence-subtle text-status-needs_more_evidence";
  return "bg-status-rejected-subtle text-status-rejected";
}

export function EvidenceGallery({ evidence }: { evidence: Evidence[] }) {
  const sorted = [...evidence].sort((a, b) => a.sequence - b.sequence);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const lightboxImages = sorted.map((item) => ({
    src: item.photoUrl,
    alt: `Evidence photo ${item.sequence}`,
    caption: `Photo #${item.sequence} · submitted ${absoluteDateTime(item.submittedAt)}`,
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
              <img
                src={item.photoUrl}
                alt={`Evidence photo ${item.sequence}`}
                className="h-48 w-full object-cover"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100 focus-visible:opacity-100">
                <ZoomIn className="size-6 text-white" aria-hidden="true" />
              </span>
              {phase === "done" && item.aiConfidenceNote?.confidence != null && (
                <span
                  className={cn(
                    "absolute top-2 right-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm",
                    confidenceBadgeClass(item.aiConfidenceNote.confidence),
                  )}
                >
                  <Bot className="size-3.5 shrink-0" aria-hidden="true" />
                  {Math.round(item.aiConfidenceNote.confidence * 100)}% match
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
                  Reviewed by Officer #{item.reviewedByOfficerId}
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
