import { useState } from "react";
import {
  BotOff,
  Loader2,
  Sparkles,
  TrendingUp,
  MapPinned as ZoneIcon,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { useZones } from "@/hooks/useZones";
import { useOfficerPerformance } from "@/hooks/useOfficerPerformance";
import { useAiZoneReport } from "@/hooks/useAiZoneReport";
import { useGenerateAiZoneReport } from "@/hooks/useGenerateAiZoneReport";
import type { OfficerPerformance } from "@/types/api";

export function AdminOfficersPage() {
  const [tab, setTab] = useState("performance");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-display-sm font-semibold text-ink">
          Officers
        </h1>
        <p className="text-ink-muted mt-1 text-sm">
          Performance scorecards and AI-generated zone health reports.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="performance">Officer Performance</TabsTrigger>
          <TabsTrigger value="ai-reports">AI Zone Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="performance" className="mt-6">
          <PerformanceTab />
        </TabsContent>
        <TabsContent value="ai-reports" className="mt-6">
          <AiReportsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PerformanceTab() {
  const { data: officers } = useAdminUsers({ role: "OFFICER", pageSize: 100 });
  const [officerId, setOfficerId] = useState("");
  const [period, setPeriod] = useState<"this_month" | "last_month" | "all_time">(
    "this_month",
  );
  const { data: perf, isLoading } = useOfficerPerformance(officerId || undefined, {
    period,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-4">
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="perf-officer">Officer</Label>
          <Select
            id="perf-officer"
            value={officerId}
            onChange={(e) => setOfficerId(e.target.value)}
          >
            <option value="">Select an officer…</option>
            {officers?.data.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.email})
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="perf-period">Period</Label>
          <Select
            id="perf-period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as typeof period)}
          >
            <option value="this_month">This month</option>
            <option value="last_month">Last month</option>
            <option value="all_time">All time</option>
          </Select>
        </div>
      </div>

      {!officerId ? (
        <EmptyState
          icon={TrendingUp}
          title="Pick an officer"
          description="Their scorecard will appear here."
          className="rounded-lg border border-line bg-surface"
        />
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : perf ? (
        <PerformanceScorecard perf={perf} />
      ) : null}
    </div>
  );
}

function PerformanceScorecard({ perf }: { perf: OfficerPerformance }) {
  const acceptPct =
    perf.acceptRejectRatio != null ? Math.round(perf.acceptRejectRatio * 100) : null;

  return (
    <div className="space-y-5 rounded-lg border border-line bg-surface p-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total handled" value={perf.totalHandled} />
        <Stat label="On time" value={perf.onTime ?? 0} accent="text-sla-on_time" />
        <Stat label="Delayed" value={perf.delayed ?? 0} accent="text-sla-delayed" />
        <Stat label="Overdue" value={perf.overdue ?? 0} accent="text-sla-overdue" />
      </div>
      <p className="text-ink-faint text-xs">
        {perf.unresolvableExcluded ?? 0} complaint
        {(perf.unresolvableExcluded ?? 0) === 1 ? "" : "s"} marked Unresolvable are
        excluded from the figures above.
      </p>

      <div className="border-t border-line pt-4">
        <p className="text-ink-muted mb-3 text-sm font-medium">Evidence review</p>
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Valid" value={perf.evidenceBreakdown?.valid ?? 0} accent="text-status-resolved" />
          <Stat
            label="Needed more"
            value={perf.evidenceBreakdown?.needsMoreEvidence ?? 0}
            accent="text-status-needs_more_evidence"
          />
          <Stat label="Rejected" value={perf.evidenceBreakdown?.rejected ?? 0} accent="text-status-rejected" />
        </div>
        {acceptPct != null && (
          <p className="text-ink-muted mt-3 text-sm">
            Accept rate: <span className="font-medium text-ink">{acceptPct}%</span>
          </p>
        )}
      </div>

      <div className="border-t border-line pt-4">
        <Stat
          label="Avg. resolution time"
          value={perf.avgResolutionHours != null ? `${Math.round(perf.avgResolutionHours)}h` : "—"}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div>
      <p className="text-ink-faint text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-semibold ${accent ?? "text-ink"}`}>
        {value}
      </p>
    </div>
  );
}

function AiReportsTab() {
  const { data: zones } = useZones();
  const [zoneId, setZoneId] = useState("");
  const { data: report, isError, isLoading } = useAiZoneReport(zoneId || undefined);
  const generate = useGenerateAiZoneReport(zoneId);

  return (
    <div className="space-y-5">
      <div className="max-w-sm">
        <Label htmlFor="ai-zone">Zone</Label>
        <Select id="ai-zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
          <option value="">Select a zone…</option>
          {zones?.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </Select>
      </div>

      {!zoneId ? (
        <EmptyState
          icon={ZoneIcon}
          title="Pick a zone"
          description="Generate or view its latest AI health report."
          className="rounded-lg border border-line bg-surface"
        />
      ) : isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="space-y-4 rounded-lg border border-line bg-surface p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Sparkles className="text-brand size-5" aria-hidden="true" />
              <h2 className="font-display text-base font-semibold text-ink">
                AI health report
              </h2>
            </div>
            <Button size="sm" loading={generate.isPending} onClick={() => generate.mutate()}>
              {report ? "Regenerate" : "Generate report"}
            </Button>
          </div>

          {isError && !report ? (
            <p className="text-ink-muted text-sm">
              No report has been generated for this zone yet.
            </p>
          ) : report?.status === "PENDING" ? (
            <p className="text-ink-muted flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Generating — this usually takes a few seconds.
            </p>
          ) : report?.status === "FAILED" || report?.aiAvailable === false ? (
            <p className="text-ink-muted flex items-center gap-2 text-sm">
              <BotOff className="size-4 shrink-0" aria-hidden="true" />
              The AI model was unavailable when this report was requested. The rest of the
              dashboard is unaffected — try generating again shortly.
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
      )}
    </div>
  );
}

function ReportSection({ title, text }: { title: string; text?: string | null }) {
  if (!text) return null;
  return (
    <div>
      <p className="text-ink-faint text-xs font-medium tracking-wide uppercase">{title}</p>
      <p className="text-ink-muted mt-1 leading-relaxed">{text}</p>
    </div>
  );
}
