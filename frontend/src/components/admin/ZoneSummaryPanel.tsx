import { Link } from "react-router-dom";
import { Boxes } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { useZoneSummary } from "@/hooks/useZoneSummary";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-ink-faint text-xs font-medium tracking-wide uppercase">
        {label}
      </p>
      <p className="mt-1 font-mono text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

/** Compact `GET /zones/{zoneId}/summary` readout — shared by the Dashboard's
 * per-zone expansion and the Zones & SLAs page. */
export function ZoneSummaryPanel({ zoneId }: { zoneId: string }) {
  const { data: summary, isLoading } = useZoneSummary(zoneId);

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (!summary) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-line bg-surface p-4">
      <Stat label="Total complaints" value={summary.totalComplaints ?? 0} />
      <Stat label="Active" value={summary.activeComplaints ?? 0} />
      <Stat label="Resolved" value={summary.resolvedComplaints ?? 0} />
      <Stat label="Total clusters" value={summary.totalClusters ?? 0} />
      <Stat label="Active clusters" value={summary.activeClusters ?? 0} />
      <Link
        to={`/admin/clusters?zone=${zoneId}`}
        className="text-brand ml-auto inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
      >
        <Boxes className="size-4" aria-hidden="true" />
        View clusters
      </Link>
    </div>
  );
}
