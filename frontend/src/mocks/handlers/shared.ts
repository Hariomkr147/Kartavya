import { http, HttpResponse } from "msw";
import { db } from "../db/store";
import { toCluster, toClusterDetail } from "../serializers";
import { requireRole, paginate, parsePagination, Errors } from "../lib/http";
import { fromApiId, toApiId } from "../lib/ids";
import { TERMINAL_STATUSES } from "../lib/fsm";
import { liveClusterIds } from "../lib/cluster";

const BASE = "/api/v1";

export const sharedHandlers = [
  http.get(`${BASE}/clusters`, ({ request }) => {
    const auth = requireRole(request, "OFFICER", "ADMIN");
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    // Dissolved clusters — every member finished and left — are hidden. The
    // rows stay (they hold the one-time reward latch) but nothing can be done
    // to them, so listing them is pure noise that only accumulates.
    const live = liveClusterIds();
    let rows = db.clusters.filter((c) => live.has(c.id));
    if (auth.user.role === "OFFICER") {
      rows = rows.filter((c) => c.zoneId === auth.user.zoneId);
    } else {
      const zoneId = url.searchParams.get("zoneId");
      if (zoneId) rows = rows.filter((c) => c.zoneId === fromApiId(zoneId));
    }

    const { data, pagination } = paginate(rows, parsePagination(url));
    return HttpResponse.json({ data: data.map(toCluster), pagination });
  }),

  http.get(`${BASE}/clusters/:clusterId`, ({ request, params }) => {
    const auth = requireRole(request, "OFFICER", "ADMIN");
    if (!auth.ok) return auth.response;

    const cluster = db.clusters.find((c) => c.id === fromApiId(String(params.clusterId)));
    if (!cluster || !liveClusterIds().has(cluster.id)) return Errors.notFound();
    if (auth.user.role === "OFFICER" && cluster.zoneId !== auth.user.zoneId)
      return Errors.forbidden();

    return HttpResponse.json(toClusterDetail(cluster));
  }),

  http.get(`${BASE}/zones/:zoneId/summary`, ({ request, params }) => {
    const auth = requireRole(request, "OFFICER", "ADMIN");
    if (!auth.ok) return auth.response;

    const zoneId = fromApiId(String(params.zoneId));
    const zone = db.zones.find((z) => z.id === zoneId);
    if (!zone) return Errors.notFound();
    if (auth.user.role === "OFFICER" && zoneId !== auth.user.zoneId)
      return Errors.forbidden();

    const complaints = db.complaints.filter((c) => c.zoneId === zoneId);
    const clusters = db.clusters.filter((c) => c.zoneId === zoneId);
    const activeClusters = clusters.filter((cluster) =>
      db.complaints.some(
        (c) => c.clusterId === cluster.id && !TERMINAL_STATUSES.has(c.status),
      ),
    );

    return HttpResponse.json({
      zoneId: toApiId(zoneId!),
      totalComplaints: complaints.length,
      activeComplaints: complaints.filter((c) => !TERMINAL_STATUSES.has(c.status)).length,
      resolvedComplaints: complaints.filter((c) => c.status === "CLOSED").length,
      totalClusters: clusters.length,
      activeClusters: activeClusters.length,
    });
  }),
];
