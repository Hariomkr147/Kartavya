import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
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

/**
 * `attribution` must match who actually authored the quoted `reason` for the
 * given status — REOPENED's reason is the citizen's own dispute text, and a
 * CLOSED reached via a rejected dispute carries the admin's verdict, not an
 * officer's; only the other statuses' reasons come from the reviewing officer.
 */
function AttributedQuote({
  attribution,
  children,
}: {
  attribution: string;
  children: ReactNode;
}) {
  return (
    <figure className="bg-surface/70 mt-3 rounded-md border border-line p-3">
      <div className="flex gap-2">
        <Quote className="text-ink-faint mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <blockquote className="text-sm leading-relaxed text-ink">{children}</blockquote>
      </div>
      <figcaption className="text-ink-faint mt-1.5 pl-5.5 text-xs">
        — {attribution}
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
  const { t } = useTranslation();
  const statusReason = latestStatusReason(complaint.status, complaint.statusHistory);

  if (complaint.status === "NEEDS_MORE_EVIDENCE") {
    const reason = evidenceRequestReason(complaint.evidence) ?? statusReason;
    return (
      <PanelShell
        tone="action"
        icon={TriangleAlert}
        title={t("actionPanel.needsEvidence.title")}
      >
        <p className="text-ink-muted mt-1 text-sm">
          {t("actionPanel.needsEvidence.body")}
        </p>
        {reason && (
          <AttributedQuote attribution={t("actionPanel.attribution.officer")}>
            {reason}
          </AttributedQuote>
        )}
        <p className="text-ink-faint mt-3 text-xs">{t("actionPanel.needsEvidence.note")}</p>
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
          {t("actionPanel.needsEvidence.submit")}
        </Button>
      </PanelShell>
    );
  }

  if (complaint.status === "RESOLVED") {
    return (
      <PanelShell tone="good" icon={BadgeCheck} title={t("actionPanel.resolved.title")}>
        <p className="text-ink-muted mt-1 text-sm">{t("actionPanel.resolved.body")}</p>
        {statusReason && (
          <AttributedQuote attribution={t("actionPanel.attribution.officer")}>
            {statusReason}
          </AttributedQuote>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button size="sm" loading={confirming} onClick={onConfirm}>
            <ThumbsUp className="size-4" aria-hidden="true" />
            {t("actionPanel.resolved.confirm")}
          </Button>
          <Button size="sm" variant="outline" onClick={onOpenDispute}>
            <ThumbsDown className="size-4" aria-hidden="true" />
            {t("actionPanel.resolved.dispute")}
          </Button>
        </div>
        <p className="text-ink-faint mt-3 text-xs">
          {t("actionPanel.resolved.note")}
        </p>
      </PanelShell>
    );
  }

  if (complaint.status === "REOPENED") {
    return (
      <PanelShell tone="waiting" icon={Gavel} title={t("actionPanel.reopened.title")}>
        <p className="text-ink-muted mt-1 text-sm">{t("actionPanel.reopened.body")}</p>
        {statusReason && (
          <AttributedQuote attribution={t("actionPanel.attribution.dispute")}>
            {statusReason}
          </AttributedQuote>
        )}
      </PanelShell>
    );
  }

  if (complaint.status === "REJECTED") {
    return (
      <PanelShell tone="bad" icon={XCircle} title={t("actionPanel.rejected.title")}>
        <p className="text-ink-muted mt-1 text-sm">{t("actionPanel.rejected.body")}</p>
        {statusReason && (
          <AttributedQuote attribution={t("actionPanel.attribution.officer")}>
            {statusReason}
          </AttributedQuote>
        )}
      </PanelShell>
    );
  }

  if (complaint.status === "UNRESOLVABLE") {
    return (
      <PanelShell tone="bad" icon={XCircle} title={t("actionPanel.unresolvable.title")}>
        <p className="text-ink-muted mt-1 text-sm">
          {t("actionPanel.unresolvable.body")}
        </p>
        {statusReason && (
          <AttributedQuote attribution={t("actionPanel.attribution.officer")}>
            {statusReason}
          </AttributedQuote>
        )}
      </PanelShell>
    );
  }

  if (complaint.status === "CLOSED") {
    return (
      <PanelShell
        tone="good"
        icon={CircleCheck}
        title={t("actionPanel.closed.title")}
      >
        <p className="text-ink-muted mt-1 text-sm">{t("actionPanel.closed.body")}</p>
        {statusReason && (
          <AttributedQuote attribution={t("actionPanel.attribution.admin")}>
            {statusReason}
          </AttributedQuote>
        )}
      </PanelShell>
    );
  }

  // SUBMITTED / EVIDENCE_UNDER_REVIEW / UNDER_REVIEW / IN_PROGRESS /
  // UNDER_RESOLUTION — the city owns the next move. Saying so explicitly
  // beats leaving the page silent.
  return (
    <PanelShell tone="waiting" icon={Hourglass} title={t("actionPanel.waiting.title")}>
      <p className="text-ink-muted mt-1 text-sm">
        {complaint.assignedOfficerId
          ? t("actionPanel.waiting.assigned", { officerId: complaint.assignedOfficerId })
          : t("actionPanel.waiting.queued")}
      </p>
    </PanelShell>
  );
}
