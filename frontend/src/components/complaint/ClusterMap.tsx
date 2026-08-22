import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { MiniMap, type MiniMapPin } from "@/components/ui/MiniMap";
import { StatusPill } from "@/components/ui/pills";
import { relativeTime } from "@/lib/datetime";
import type { ClusterDetail } from "@/types/api";

/**
 * A cluster on the map: one pin per member complaint, plus the centroid.
 *
 * A cluster is several citizens reporting one physical issue from wherever
 * each of them stood — the potholed stretch, not the point. Plotting only
 * `centroidLat`/`centroidLng` drew all of that as a single pin, which is
 * exactly the "this is one report" reading clusters exist to correct. Each
 * member now gets its own marker, and its popup links to the complaint so the
 * map is a way into the reports rather than a picture of them.
 *
 * Members whose coordinates are missing are skipped rather than dropped to
 * (0, 0) — `latitude`/`longitude` are optional on the compact `Complaint`
 * shape, and a pin in the Gulf of Guinea is worse than no pin.
 */
export function ClusterMap({
  cluster,
  hrefFor,
  height = 200,
}: {
  cluster: ClusterDetail;
  hrefFor: (complaintId: string) => string;
  height?: number;
}) {
  const { t } = useTranslation();

  const pins = useMemo<MiniMapPin[]>(() => {
    const members = cluster.complaints
      .filter((c) => c.latitude != null && c.longitude != null)
      .map<MiniMapPin>((c) => ({
        id: c.id,
        lat: c.latitude as number,
        lng: c.longitude as number,
        popup: (
          <span className="block space-y-1">
            <Link
              to={hrefFor(c.id)}
              className="text-brand block font-mono text-xs font-medium hover:underline"
            >
              {c.id}
            </Link>
            <span className="block">
              <StatusPill status={c.status} />
            </span>
            <span className="text-ink-muted block text-xs">
              {relativeTime(c.createdAt)}
            </span>
          </span>
        ),
      }));

    return [
      ...members,
      {
        id: `centroid:${cluster.id}`,
        lat: cluster.centroidLat,
        lng: cluster.centroidLng,
        variant: "centroid",
        label: t("clusterDetail.centroid"),
      },
    ];
  }, [cluster, hrefFor, t]);

  return (
    <>
      <MiniMap pins={pins} height={height} />
      <p className="text-ink-muted mt-2 text-xs">
        {/* The feed's map note says exactly this and is already translated
            into all eleven locales; a cluster-specific string would have been
            the same sentence with one fewer translation behind it. */}
        {t("feed.mapNote", {
          pins: pins.length - 1,
          total: cluster.complaints.length,
        })}
      </p>
    </>
  );
}
