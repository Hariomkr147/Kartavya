import type { ReactNode } from "react";
import {
  BadgeCheck,
  CircleCheck,
  Gavel,
  Hourglass,
  Quote,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FileDropzone } from "@/components/ui/FileDropzone";
import { latestStatusReason } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";
import type { ComplaintDetail, Evidence } from "@/types/api";

type Tone = "action" | "waiting" | "good" | "bad";

const TONE_CLASSES: Record<Tone, { card: string; icon: string }> = {
  action: {
    card: "border-status-needs_more_evidence/30 bg-status-needs_more_evidence-subtle",
    icon: "text-status-needs_more_evidence",
  },
  waiting: { card: "border-line bg-surface", icon: "text-ink-muted" },
  good: {
    card: "border-status-resolved/30 bg-status-resolved-subtle",
    icon: "text-status-resolved",
  },
  bad: {
    card: "border-status-rejected/30 bg-status-rejected-subtle",
    icon: "text-status-rejected",
  },
};

/**
 * The officer's own words on why a round of evidence wasn't enough. The
 * contract marks `verdictReason` required for a NEEDS_MORE_EVIDENCE verdict,
 * and evidence is append-only with an increasing `sequence`, so the highest
 * sequence carrying that verdict is the live request.
 */
function evidenceRequestReason(evidence: Evidence[] | undefined): string | null {
  const rejected = [...(evidence ?? [])]
    .filter((item) => item.verdict === "NEEDS_MORE_EVIDENCE" && item.verdictReason)
    .sort((a, b) => b.sequence - a.sequence);
  return rejected[0]?.verdictReason?.trim() || null;
}

function OfficerQuote({ children }: { children: ReactNode }) {
  return (
    <figure className="bg-surface/70 mt-3 rounded-md border border-line p-3">
      <div className="flex gap-2">
        <Quote className="text-ink-faint mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <blockquote className="text-sm leading-relaxed text-ink">{children}</blockquote>
      </div>
      <figcaption className="text-ink-faint mt-1.5 pl-5.5 text-xs">
        — the reviewing officer
      </figcaption>
    </figure>
  );
}

function PanelShell({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: Tone;
  icon: typeof TriangleAlert;
  title: string;
  children: ReactNode;
}) {
  const classes = TONE_CLASSES[tone];
  return (
    <section className={cn("rounded-lg border p-5", classes.card)}>
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 size-5 shrink-0", classes.icon)} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
          {children}
        </div>
      </div>
    </section>
  );
}

export interface ActionRequiredPanelProps {
  complaint: ComplaintDetail;
  resubmitPhoto: File | null;
  onResubmitPhotoChange: (file: File | null) => void;
  onResubmit: () => void;
  resubmitting: boolean;
  onConfirm: () => void;
  confirming: boolean;
  onOpenDispute: () => void;
}

/**
 * One block, always in the same place, that answers "is the ball in my
 * court?" for every status the state machine can be in — including the
 * states that previously rendered nothing at all (rejected, unresolvable,
 * reopened) and the ones where the honest answer is "nothing, we're on it".
 * Every explanation shown here is the server's own recorded `reason` /
 * `verdictReason`; none of it is invented client-side.
 */
export function ActionRequiredPanel({
  complaint,
  resubmitPhoto,
  onResubmitPhotoChange,
  onResubmit,
  resubmitting,
  onConfirm,
  confirming,
  onOpenDispute,
}: ActionRequiredPanelProps) {
  const statusReason = latestStatusReason(complaint.status, complaint.statusHistory);

  if (complaint.status === "NEEDS_MORE_EVIDENCE") {
    const reason = evidenceRequestReason(complaint.evidence) ?? statusReason;
    return (
      <PanelShell tone="action" icon={TriangleAlert} title="A clearer photo is needed">
        <p className="text-ink-muted mt-1 text-sm">
          The officer reviewing your report couldn't act on the evidence so far. Add
          another photo and it goes straight back to them.
        </p>
        {reason && <OfficerQuote>{reason}</OfficerQuote>}
        <p className="text-ink-faint mt-3 text-xs">
          The resolution clock is paused while this waits on you — the time you take
          isn't counted against the city's target.
        </p>
        <div className="mt-3 max-w-sm">
          <FileDropzone
            files={resubmitPhoto ? [resubmitPhoto] : []}
            onFilesChange={(files) => onResubmitPhotoChange(files[0] ?? null)}
          />
        </div>
        <Button
          size="sm"
          className="mt-3"
          disabled={!resubmitPhoto}
          loading={resubmitting}
          onClick={onResubmit}
        >
          Resubmit evidence
        </Button>
      </PanelShell>
    );
  }

  if (complaint.status === "RESOLVED") {
    return (
      <PanelShell tone="good" icon={BadgeCheck} title="Is this actually fixed?">
        <p className="text-ink-muted mt-1 text-sm">
          An officer marked this resolved. You're the one who can verify it on the
          ground — confirm the fix to close it, or dispute it if the problem is still
          there.
        </p>
        {statusReason && <OfficerQuote>{statusReason}</OfficerQuote>}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button size="sm" loading={confirming} onClick={onConfirm}>
            <ThumbsUp className="size-4" aria-hidden="true" />
            Confirm the fix
          </Button>
          <Button size="sm" variant="outline" onClick={onOpenDispute}>
            <ThumbsDown className="size-4" aria-hidden="true" />
            It's not actually fixed
          </Button>
        </div>
        <p className="text-ink-faint mt-3 text-xs">
          Confirming credits your Civic Service Points. If nobody confirms, the city
          closes it automatically after its timeout — and that path credits no points at
          all.
        </p>
      </PanelShell>
    );
  }

  if (complaint.status === "REOPENED") {
    return (
      <PanelShell tone="waiting" icon={Gavel} title="Your dispute is being reviewed">
        <p className="text-ink-muted mt-1 text-sm">
          An administrator is weighing up your evidence. If they uphold the dispute it
          goes back to an officer to fix; if not, it closes here. Nothing is needed from
          you in the meantime.
        </p>
        {statusReason && <OfficerQuote>{statusReason}</OfficerQuote>}
      </PanelShell>
    );
  }

  if (complaint.status === "REJECTED") {
    return (
      <PanelShell tone="bad" icon={XCircle} title="This report was rejected">
        <p className="text-ink-muted mt-1 text-sm">
          An officer decided this wasn't a civic issue they could act on. Rejection is
          final for this report — if the problem is real and ongoing, file a fresh one
          with clearer photos.
        </p>
        {statusReason && <OfficerQuote>{statusReason}</OfficerQuote>}
      </PanelShell>
    );
  }

  if (complaint.status === "UNRESOLVABLE") {
    return (
      <PanelShell tone="bad" icon={XCircle} title="Marked unresolvable">
        <p className="text-ink-muted mt-1 text-sm">
          The zone office concluded this can't be fixed through the complaints process.
          It stops here.
        </p>
        {statusReason && <OfficerQuote>{statusReason}</OfficerQuote>}
      </PanelShell>
    );
  }

  if (complaint.status === "CLOSED") {
    return (
      <PanelShell tone="good" icon={CircleCheck} title="Closed — thanks for seeing it through">
        <p className="text-ink-muted mt-1 text-sm">
          This report is finished. Any points it earned are in your ledger under My
          Kartavya.
        </p>
        {statusReason && <OfficerQuote>{statusReason}</OfficerQuote>}
      </PanelShell>
    );
  }

  // SUBMITTED / EVIDENCE_UNDER_REVIEW / UNDER_REVIEW / IN_PROGRESS /
  // UNDER_RESOLUTION — the city owns the next move. Saying so explicitly
  // beats leaving the page silent.
  return (
    <PanelShell tone="waiting" icon={Hourglass} title="Nothing needed from you right now">
      <p className="text-ink-muted mt-1 text-sm">
        {complaint.assignedOfficerId
          ? `Officer #${complaint.assignedOfficerId} has this one. We'll ask you to confirm as soon as they mark it fixed.`
          : "Your report is in the zone queue. We'll ask you to confirm as soon as an officer marks it fixed."}
      </p>
    </PanelShell>
  );
}
