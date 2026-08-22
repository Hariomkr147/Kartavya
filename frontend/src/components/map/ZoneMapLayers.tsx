import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { resolveApiAssetUrl } from "@/services/http";
import {
  zoneHue,
  zoneLabelPosition,
  zoneVoronoiCells,
  type LatLngBounds,
} from "@/lib/zoneVoronoi";
import type { ZoneMapLayerState } from "@/lib/zoneMapLayers";
import type { Cluster, ClusterDetail, Complaint, SeverityLabel, Zone } from "@/types/api";

/**
 * Where a mark leads when it is clicked.
 *
 * The same map serves an admin and an officer, and the two apps route the
 * same row differently — an admin's complaint lives at
 * `/admin/complaints/{id}`, an officer's at `/officer/queue/{id}`. Passing
 * the paths in keeps this component ignorant of both route tables rather than
 * teaching it to branch on a role, which is the thing that would otherwise
 * have to be edited again for the next audience.
 */
export interface ZoneMapLinks {
  complaint: (complaintId: string) => string;
  cluster: (clusterId: string) => string;
}

/**
 * One palette for the whole map, ordered LOW → CRITICAL.
 *
 * Every mark takes its colour from this ramp and nothing else, so colour
 * always means severity and never anything else. What a mark *is* is carried
 * by its shape instead:
 *
 *   teardrop pin   an independent complaint — one citizen, one place
 *   counted disc   a cluster — several reports averaged to a centroid
 *   small diamond  a member of a cluster, tethered back to its disc
 *
 * Keeping shape-for-identity and colour-for-severity separable is what lets a
 * red diamond and a red pin be told apart even though they share a colour —
 * and what keeps the map readable for someone who cannot distinguish the
 * ramp's hues at all.
 */
const SEVERITY_COLOR: Record<SeverityLabel, string> = {
  LOW: "#0d9488", // teal 600
  MEDIUM: "#d97706", // amber 600
  HIGH: "#ea580c", // orange 600
  CRITICAL: "#e11d48", // rose 600
};

/** Severity is only scored once a complaint is accepted; before that, slate. */
const UNSCORED_COLOR = "#64748b";

function severityColor(label?: SeverityLabel): string {
  return (label && SEVERITY_COLOR[label]) || UNSCORED_COLOR;
}

/**
 * Stacking order for overlapping marks.
 *
 * Leaflet stacks markers by latitude alone, so a cluster disc will slide
 * underneath any ordinary pin that happens to sit south of it — and a cluster
 * is precisely where marks pile up, so the summary of a dozen reports is the
 * thing most likely to end up hidden. Order them by what they mean instead:
 * the disc reads first, then the independent pins, then the members it
 * already accounts for.
 */
const Z_CLUSTER = 1000;
const Z_STANDALONE = 0;
const Z_MEMBER = -500;
const Z_ZONE_LABEL = -1000;

/**
 * The line tying a cluster member back to its cluster.
 *
 * Near-black rather than the member's severity colour, and deliberately so:
 * a tether asserts membership, not urgency, and colouring it by severity had
 * it competing with the marks for the one thing colour is supposed to mean
 * here. Neutral, it stays a piece of connective tissue.
 *
 * Dashed rather than solid, at this weight, so a tether is never mistaken for
 * a road or a zone boundary — the two other kinds of line on the map.
 */
const TETHER_STYLE = {
  color: "#18181b",
  weight: 2.5,
  opacity: 0.8,
  dashArray: "5 5",
  lineCap: "round" as const,
  interactive: false,
};

/**
 * How strongly a zone's cell is drawn.
 *
 * An officer works exactly one zone, so their map has a figure and a ground:
 * the assigned cell is the work, and its neighbours are there only because a
 * Voronoi cell has no shape without them — the boundary between two zones IS
 * the perpendicular bisector of their centres, so the adjacent zones cannot
 * simply be dropped. Drawing them faintly says "this is the edge of your
 * patch" without inviting an officer to hunt for their complaints over there;
 * the server would not have sent any.
 *
 * With no home zone (the admin map) every cell is drawn at full strength,
 * because no zone is more the admin's than another.
 */
const CELL_HOME = { weight: 2.5, fillOpacity: 0.16, opacity: 1 };
const CELL_NEUTRAL = { weight: 1.5, fillOpacity: 0.12, opacity: 1 };
const CELL_NEIGHBOUR = { weight: 1, fillOpacity: 0.04, opacity: 0.55 };

/** One drop shadow, so every mark reads as part of the same family of objects. */
const SHADOW = "drop-shadow(0 1px 1.5px rgba(0,0,0,.45))";

/**
 * An independent complaint. Drawn as inline SVG rather than Leaflet's bundled
 * PNG so the fill can carry severity.
 */
function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<svg width="26" height="34" viewBox="0 0 26 34" fill="none"
        style="filter:${SHADOW}" xmlns="http://www.w3.org/2000/svg">
        <path d="M13 33C13 33 24 20.5 24 12.6 24 6.2 19.1 1 13 1S2 6.2 2 12.6C2 20.5 13 33 13 33Z"
          fill="${color}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>
        <circle cx="13" cy="12.4" r="4" fill="#ffffff" fill-opacity=".92"/>
      </svg>`,
    iconSize: [26, 34],
    iconAnchor: [13, 33],
    tooltipAnchor: [0, -30],
  });
}

/** A cluster: a disc carrying its report count, and sized by it. */
function clusterIcon(cluster: Cluster): L.DivIcon {
  const size = Math.round(Math.min(50, 26 + Math.sqrt(cluster.reportCount) * 5.5));
  const color = severityColor(cluster.severityLabel);
  return L.divIcon({
    className: "",
    html: `<span style="display:flex;align-items:center;justify-content:center;
        width:${size}px;height:${size}px;border-radius:9999px;box-sizing:border-box;
        background:${color};color:#fff;border:3px solid #fff;filter:${SHADOW};
        font:700 ${Math.max(11, Math.round(size / 2.9))}px/1 ui-sans-serif,system-ui,sans-serif;
        letter-spacing:-.02em">${cluster.reportCount}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    tooltipAnchor: [0, -size / 2 - 2],
  });
}

/** A cluster member: a diamond, deliberately unlike both the pin and the disc. */
function memberIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:13px;height:13px;box-sizing:border-box;
        background:${color};border:2px solid #fff;transform:rotate(45deg);
        border-radius:2px;filter:${SHADOW}"></span>`,
    iconSize: [17, 17],
    iconAnchor: [8.5, 8.5],
    tooltipAnchor: [0, -10],
  });
}

interface Viewport {
  /** Padded, so cells do not visibly stop at the screen edge. */
  clip: LatLngBounds;
  /** Exactly what is on screen — where a label has to land to be read. */
  visible: LatLngBounds;
}

function toBounds(b: L.LatLngBounds): LatLngBounds {
  return {
    south: b.getSouth(),
    west: b.getWest(),
    north: b.getNorth(),
    east: b.getEast(),
  };
}

/** Keeps the viewport in step with what the user has panned or zoomed to. */
function ViewportWatcher({ onChange }: { onChange: (viewport: Viewport) => void }) {
  const map = useMap();

  useEffect(() => {
    function publish() {
      const visible = map.getBounds();
      onChange({ clip: toBounds(visible.pad(0.35)), visible: toBounds(visible) });
    }
    publish();
    map.on("moveend zoomend", publish);
    return () => {
      map.off("moveend zoomend", publish);
    };
  }, [map, onChange]);

  return null;
}

/**
 * A zone's name written across its cell. Not a Leaflet tooltip: a tooltip
 * anchors to the polygon's own centre, which is off-screen the moment an
 * admin zooms into a street. This is a plain marker placed wherever
 * `zoneLabelPosition` says the visible part of the cell is.
 */
function zoneLabelIcon(name: string): L.DivIcon {
  return L.divIcon({
    className: "kv-zone-label-icon",
    html: `<span>${name.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function MarkTooltip({
  photoUrl,
  title,
  accent,
  lines,
}: {
  photoUrl?: string;
  title: string;
  accent: string;
  lines: string[];
}) {
  const resolved = photoUrl ? resolveApiAssetUrl(photoUrl) : undefined;
  return (
    <span className="block w-44">
      {resolved && (
        <img
          src={resolved}
          alt=""
          className="mb-1.5 block h-24 w-full rounded-md object-cover"
          loading="lazy"
        />
      )}
      <span className="flex items-center gap-1.5">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: accent }}
          aria-hidden="true"
        />
        <span className="font-mono text-[11px] font-semibold">{title}</span>
      </span>
      {lines.map((line) => (
        <span key={line} className="mt-0.5 block text-[11px] leading-tight opacity-75">
          {line}
        </span>
      ))}
    </span>
  );
}

/**
 * What each shape means, and what the colour ramp means, shown on the map
 * itself. Only the layers actually switched on are listed — a legend for
 * marks that are not drawn is just clutter.
 */
function Legend({ layers, homeZone }: { layers: ZoneMapLayerState; homeZone?: Zone }) {
  const { t } = useTranslation();
  const shapes: { key: string; label: string; swatch: ReactNode }[] = [];

  if (layers.standalone) {
    shapes.push({
      key: "standalone",
      label: t("zoneMap.standalone"),
      swatch: (
        <svg width="11" height="14" viewBox="0 0 26 34" aria-hidden="true">
          <path
            d="M13 33C13 33 24 20.5 24 12.6 24 6.2 19.1 1 13 1S2 6.2 2 12.6C2 20.5 13 33 13 33Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
          />
        </svg>
      ),
    });
  }
  if (layers.clusters) {
    shapes.push({
      key: "clusters",
      label: t("nav.clusters"),
      swatch: <span className="block size-3.5 rounded-full border-2 border-current" />,
    });
  }
  if (layers.clusterMembers) {
    shapes.push({
      key: "members",
      label: t("zoneMap.clusterMembers"),
      swatch: (
        <span
          className="block size-2.5 rounded-[1px] border-2 border-current"
          style={{ transform: "rotate(45deg)" }}
        />
      ),
    });
  }
  if (layers.clusterMembers && layers.tethers) {
    shapes.push({
      key: "tethers",
      label: t("zoneMap.tethers"),
      swatch: (
        <svg width="14" height="4" viewBox="0 0 14 4" aria-hidden="true">
          <line
            x1="0"
            y1="2"
            x2="14"
            y2="2"
            stroke={TETHER_STYLE.color}
            strokeWidth="2.5"
            strokeDasharray="5 5"
            strokeLinecap="round"
            opacity={TETHER_STYLE.opacity}
          />
        </svg>
      ),
    });
  }
  if (layers.zoneRegions) {
    shapes.push({
      key: "zones",
      label: t("zoneMap.zoneRegions"),
      swatch: (
        <span className="block size-3 rounded-[2px] border border-current border-dashed opacity-70" />
      ),
    });
    // Two cell weights are on screen the moment a home zone is set, and the
    // heavier one is not self-explanatory — say which is which, in the zone's
    // own hue so the swatch matches the cell it names.
    if (homeZone) {
      shapes.push({
        key: "home-zone",
        label: t("fields.yourZone"),
        swatch: (
          <span
            className="block size-3 rounded-[2px] border-2 border-dashed"
            style={{
              borderColor: `hsl(${zoneHue(homeZone.code)} 55% 45%)`,
              background: `hsl(${zoneHue(homeZone.code)} 65% 52% / .16)`,
            }}
          />
        ),
      });
    }
  }
  if (shapes.length === 0) return null;

  // Slate is a real value on this ramp, not a placeholder: severity is only
  // scored once a complaint is accepted. Naming it here stops an admin reading
  // every unaccepted report as "low".
  const ramp: [string, string][] = [
    ...(Object.keys(SEVERITY_COLOR) as SeverityLabel[]).map(
      (label) => [SEVERITY_COLOR[label], t(`severity.${label}`)] as [string, string],
    ),
    [UNSCORED_COLOR, t("adminDashboard.pending")],
  ];

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[400] rounded-md border border-line bg-surface/95 px-3 py-2 shadow-sm backdrop-blur">
      <ul className="space-y-1.5">
        {shapes.map((shape) => (
          <li key={shape.key} className="flex items-center gap-2">
            <span className="text-ink-muted flex size-3.5 items-center justify-center">
              {shape.swatch}
            </span>
            <span className="text-ink text-[11px] leading-none font-medium">
              {shape.label}
            </span>
          </li>
        ))}
      </ul>
      <ul className="mt-2 flex flex-wrap gap-x-2 gap-y-1 border-t border-line pt-2">
        {ramp.map(([color, label]) => (
          <li key={label} className="flex items-center gap-1">
            <span className="block size-2 rounded-full" style={{ background: color }} />
            <span className="text-ink-muted text-[10px] leading-none">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ZoneMapLayers({
  zones,
  clusters,
  standalone,
  clusterDetails,
  layers,
  links,
  homeZoneId,
  height = 620,
}: {
  zones: Zone[];
  clusters: Cluster[];
  standalone: Complaint[];
  clusterDetails: ClusterDetail[];
  layers: ZoneMapLayerState;
  links: ZoneMapLinks;
  /** The one zone this viewer works, if they have one. Drawn as the figure. */
  homeZoneId?: string;
  height?: number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [viewport, setViewport] = useState<Viewport | null>(null);

  const homeZone = useMemo(
    () => zones.find((z) => z.id === homeZoneId),
    [zones, homeZoneId],
  );

  // An officer opens this map to see their own patch, so it opens there
  // rather than on the mean of every zone in the city — which, with zones
  // spread across a district, can be a place they have no complaints in.
  const centre = useMemo<[number, number]>(() => {
    if (homeZone) return [homeZone.centerLat, homeZone.centerLng];
    const placed = zones.filter((z) => !z.isCatchAll && z.isActive);
    if (placed.length === 0) return [12.9716, 77.5946];
    return [
      placed.reduce((s, z) => s + z.centerLat, 0) / placed.length,
      placed.reduce((s, z) => s + z.centerLng, 0) / placed.length,
    ];
  }, [zones, homeZone]);

  // Recomputed as the viewport moves: cells are clipped to what is on screen,
  // so panning must re-clip rather than leave cells stopping at the old edge.
  const cells = useMemo(
    () => (viewport ? zoneVoronoiCells(zones, viewport.clip) : []),
    [zones, viewport],
  );

  const centroidById = useMemo(
    () => new Map(clusters.map((c) => [c.id, [c.centroidLat, c.centroidLng] as const])),
    [clusters],
  );

  const members = useMemo(
    () =>
      clusterDetails.flatMap((detail) =>
        detail.complaints
          .filter((c) => c.latitude != null && c.longitude != null)
          .map((c) => ({
            complaint: c,
            clusterId: detail.id,
            color: severityColor(detail.severityLabel),
          })),
      ),
    [clusterDetails],
  );

  return (
    <div
      className="relative isolate overflow-hidden rounded-lg border border-line"
      style={{ height }}
    >
      <MapContainer center={centre} zoom={12} className="size-full" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ViewportWatcher onChange={setViewport} />

        {layers.zoneRegions &&
          cells.map(({ zone, ring }) => {
            const hue = zoneHue(zone.code);
            const emphasis = !homeZoneId
              ? CELL_NEUTRAL
              : zone.id === homeZoneId
                ? CELL_HOME
                : CELL_NEIGHBOUR;
            return (
              <Polygon
                key={zone.id}
                positions={ring}
                pathOptions={{
                  color: `hsl(${hue} 55% 45%)`,
                  dashArray: "5 4",
                  fillColor: `hsl(${hue} 65% 52%)`,
                  ...emphasis,
                }}
              />
            );
          })}

        {layers.zoneRegions &&
          layers.zoneLabels &&
          viewport &&
          cells.map(({ zone, ring }) => {
            const at = zoneLabelPosition(ring, viewport.visible);
            if (!at) return null;
            return (
              <Marker
                key={`label:${zone.id}`}
                position={at}
                icon={zoneLabelIcon(zone.name)}
                interactive={false}
                zIndexOffset={Z_ZONE_LABEL}
              />
            );
          })}

        {/* Drawn before the marks so the tethers sit underneath them. Each line
            ties one member to its cluster's centroid, which is the cue that
            survives when marks overlap: a diamond on a string belongs to the
            disc at the other end. */}
        {layers.clusterMembers &&
          layers.tethers &&
          members.map(({ complaint, clusterId }) => {
            const centroid = centroidById.get(clusterId);
            if (!centroid) return null;
            return (
              <Polyline
                key={`tether:${clusterId}:${complaint.id}`}
                positions={[
                  [complaint.latitude as number, complaint.longitude as number],
                  [centroid[0], centroid[1]],
                ]}
                pathOptions={TETHER_STYLE}
              />
            );
          })}

        {layers.standalone &&
          standalone.map((c) => {
            const color = severityColor(c.severityLabel);
            return (
              <Marker
                key={c.id}
                position={[c.latitude as number, c.longitude as number]}
                icon={pinIcon(color)}
                zIndexOffset={Z_STANDALONE}
                eventHandlers={{ click: () => navigate(links.complaint(c.id)) }}
              >
                <Tooltip direction="top" className="kv-map-tip" opacity={1}>
                  <MarkTooltip
                    photoUrl={c.photoUrl}
                    title={c.id}
                    accent={color}
                    lines={[
                      c.category.name,
                      t(`status.${c.status}`),
                      // An officer's map is one zone, so naming it on every
                      // pin says nothing. Their third line is the SLA state,
                      // which is what decides where they go next.
                      (homeZoneId ? c.slaLabel && t(`sla.${c.slaLabel}`) : c.zoneName) ??
                        "",
                    ].filter(Boolean)}
                  />
                </Tooltip>
              </Marker>
            );
          })}

        {layers.clusterMembers &&
          members.map(({ complaint, clusterId, color }) => (
            <Marker
              key={`${clusterId}:${complaint.id}`}
              position={[complaint.latitude as number, complaint.longitude as number]}
              icon={memberIcon(color)}
              zIndexOffset={Z_MEMBER}
              // A member goes to the member, not the cluster — clicking one
              // citizen's report and landing on the group loses exactly the
              // thing that was clicked.
              eventHandlers={{
                click: () => navigate(links.complaint(complaint.id)),
              }}
            >
              <Tooltip direction="top" className="kv-map-tip" opacity={1}>
                <MarkTooltip
                  photoUrl={complaint.photoUrl}
                  title={complaint.id}
                  accent={color}
                  lines={[
                    complaint.category.name,
                    t(`status.${complaint.status}`),
                    t("adminComplaintDetail.partOfCluster"),
                  ]}
                />
              </Tooltip>
            </Marker>
          ))}

        {layers.clusters &&
          clusters.map((cluster) => (
            <Marker
              key={cluster.id}
              position={[cluster.centroidLat, cluster.centroidLng]}
              icon={clusterIcon(cluster)}
              zIndexOffset={Z_CLUSTER}
              eventHandlers={{ click: () => navigate(links.cluster(cluster.id)) }}
            >
              <Tooltip direction="top" className="kv-map-tip" opacity={1}>
                <MarkTooltip
                  title={cluster.id}
                  accent={severityColor(cluster.severityLabel)}
                  lines={[
                    cluster.category.name,
                    t("clusters.reports", { count: cluster.reportCount }),
                    t("clusters.uniqueReporters", {
                      count: cluster.uniqueReporterCount,
                    }),
                    t(`severity.${cluster.severityLabel}`),
                  ]}
                />
              </Tooltip>
            </Marker>
          ))}
      </MapContainer>

      <Legend layers={layers} homeZone={homeZone} />
    </div>
  );
}
