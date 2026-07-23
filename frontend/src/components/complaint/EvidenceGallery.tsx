import { Bot, BotOff, Loader2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { relativeTime } from "@/lib/datetime";
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

export function EvidenceGallery({ evidence }: { evidence: Evidence[] }) {
  const sorted = [...evidence].sort((a, b) => a.sequence - b.sequence);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {sorted.map((item) => {
        const verdict = item.verdict ? VERDICT_CONFIG[item.verdict] : null;
        return (
          <div key={item.id} className="overflow-hidden rounded-lg border border-line">
            <img
              src={item.photoUrl}
              alt={`Evidence photo ${item.sequence}`}
              className="h-48 w-full object-cover"
            />
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
              {item.aiConfidenceNote &&
                (() => {
                  const phase = screeningPhase(item.aiConfidenceNote);
                  return (
                    <div className="text-ink-faint flex items-start gap-1.5 text-xs">
                      {phase === "pending" ? (
                        <>
                          <Loader2
                            className="mt-0.5 size-3.5 shrink-0 animate-spin"
                            aria-hidden="true"
                          />
                          <span>Still analyzing this photo…</span>
                        </>
                      ) : phase === "done" ? (
                        <>
                          <Bot className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            {item.aiConfidenceNote.note}
                            {item.aiConfidenceNote.confidence != null &&
                              ` (${Math.round(item.aiConfidenceNote.confidence * 100)}% confidence)`}
                          </span>
                        </>
                      ) : (
                        <>
                          <BotOff className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            AI screening was unavailable for this photo — an officer will
                            review it directly.
                          </span>
                        </>
                      )}
                    </div>
                  );
                })()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
