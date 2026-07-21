import { http, HttpResponse } from "msw";
import { db } from "../db/store";
import { toCategory, photoUrlFor } from "../serializers";
import { severityLabel } from "../lib/severity";
import { requireRole, paginate, parsePagination, Errors } from "../lib/http";
import { sortComplaints } from "../lib/sort";
import { fromApiId, toApiId } from "../lib/ids";

const BASE = "/api/v1";

export const feedHandlers = [
  http.get(`${BASE}/feed`, ({ request }) => {
    const auth = requireRole(request, "CITIZEN");
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const requestedZoneId = url.searchParams.get("zoneId");
    if (requestedZoneId && fromApiId(requestedZoneId) !== auth.user.zoneId) {
      return Errors.forbidden("You may only browse the feed for your own zone.");
    }
    const includeResolved = url.searchParams.get("includeResolved") === "true";
    const categoryId = url.searchParams.get("categoryId");

    let rows = db.complaints.filter((c) => c.zoneId === auth.user.zoneId);
    if (!includeResolved)
      rows = rows.filter((c) => c.status !== "CLOSED" && c.status !== "REJECTED");
    if (categoryId) rows = rows.filter((c) => c.categoryId === fromApiId(categoryId));

    rows = sortComplaints(
      rows,
      url.searchParams.get("sort"),
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const { data, pagination } = paginate(rows, parsePagination(url));
    return HttpResponse.json({
      data: data.map((row) => {
        const category = db.categories.find((c) => c.id === row.categoryId)!;
        const evidence = db.evidence.find(
          (e) => e.complaintId === row.id && e.sequence === 1,
        );
        return {
          id: toApiId(row.id),
          category: toCategory(category),
          status: row.status,
          severityLabel: severityLabel(row.severityScore),
          upvoteCount: db.upvotes.filter((u) => u.complaintId === row.id).length,
          hasUpvoted: db.upvotes.some(
            (u) => u.complaintId === row.id && u.citizenId === auth.user.id,
          ),
          photoUrl: evidence ? photoUrlFor(evidence) : undefined,
          createdAt: row.createdAt,
        };
      }),
      pagination,
    });
  }),
];
