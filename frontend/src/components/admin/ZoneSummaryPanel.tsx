import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Boxes, Map as MapIcon } from "lucide-react";
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
  const { t } = useTranslation();
  const { data: summary, isLoading } = useZoneSummary(zoneId);

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (!summary) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-line bg-surface p-4">
      <Stat
        label={t("zoneSummary.totalComplaints")}
        value={summary.totalComplaints ?? 0}
      />
      <Stat label={t("zoneSummary.active")} value={summary.activeComplaints ?? 0} />
      <Stat label={t("status.RESOLVED")} value={summary.resolvedComplaints ?? 0} />
      <Stat label={t("zoneSummary.totalClusters")} value={summary.totalClusters ?? 0} />
      <Stat label={t("zoneSummary.activeClusters")} value={summary.activeClusters ?? 0} />
      {/* Both ways out of the row, kept together at the right end. The map
          carries the zone in the query string the same way the cluster list
          does, so it arrives filtered to this zone rather than to the whole
          city — and `?zone=` is what the map reads to decide which cell to
          draw as the figure. */}
      <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
        <Link
          to={`/admin/map?zone=${zoneId}`}
          className="text-brand inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
        >
          <MapIcon className="size-4" aria-hidden="true" />
          {t("nav.zoneMap")}
        </Link>
        <Link
          to={`/admin/clusters?zone=${zoneId}`}
          className="text-brand inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
        >
          <Boxes className="size-4" aria-hidden="true" />
          {t("zoneSummary.viewClusters")}
        </Link>
      </div>
    </div>
  );
}
