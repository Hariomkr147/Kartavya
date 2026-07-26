import { BotOff, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAiZoneReport } from "@/hooks/useAiZoneReport";
import { useGenerateAiZoneReport } from "@/hooks/useGenerateAiZoneReport";
import { absoluteDateTime, relativeTime } from "@/lib/datetime";

function ReportSection({ title, text }: { title: string; text?: string | null }) {
  if (!text) return null;
  return (
    <div>
      <p className="text-ink-faint text-xs font-medium tracking-wide uppercase">
        {title}
      </p>
      <p className="text-ink-muted mt-1 leading-relaxed">{text}</p>
    </div>
  );
}

/**
 * Generate/view the AI civic-health report for one zone. Shared between the
 * Zones & SLAs page (per-zone expandable row) and anywhere else that needs
 * it — pulled out of the old Officers-page "AI Zone Reports" tab, since AI
 * reports describe a zone, not an officer.
 */
export function ZoneAiReportPanel({ zoneId }: { zoneId: string }) {
  const { data: report, isError, isLoading } = useAiZoneReport(zoneId);
  const generate = useGenerateAiZoneReport(zoneId);

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="text-brand size-5" aria-hidden="true" />
          <h3 className="font-display text-sm font-semibold text-ink">AI health report</h3>
        </div>
        <div className="flex items-center gap-3">
          {report?.generatedAt && (
            <span
              className="text-ink-faint text-xs"
              title={absoluteDateTime(report.generatedAt)}
            >
              Generated {relativeTime(report.generatedAt)}
            </span>
          )}
          <Button size="sm" loading={generate.isPending} onClick={() => generate.mutate()}>
            {report ? "Regenerate" : "Generate report"}
          </Button>
        </div>
      </div>

      {isError && !report ? (
        <p className="text-ink-muted text-sm">
          No report has been generated for this zone yet.
        </p>
      ) : report?.status === "PENDING" ? (
        <p className="text-ink-muted flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Generating. This generally takes a few seconds.
        </p>
      ) : report?.status === "FAILED" || report?.aiAvailable === false ? (
        <p className="text-ink-muted flex items-center gap-2 text-sm">
          <BotOff className="size-4 shrink-0" aria-hidden="true" />
          The LLM provider seems to be down. Try again shortly.
        </p>
      ) : report?.status === "READY" ? (
        <div className="space-y-3 text-sm">
          <ReportSection title="Summary" text={report.summary} />
          <ReportSection title="Trends" text={report.trends} />
          <ReportSection title="Hotspots" text={report.hotspots} />
          <ReportSection title="Suggestions" text={report.suggestions} />
        </div>
      ) : null}
    </div>
  );
}
