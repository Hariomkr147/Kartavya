import { http, HttpResponse } from "msw";
import { db, persist, nextId } from "../db/store";
import { toComplaintDetail, toComplaintCompact } from "../serializers";
import {
  requireRole,
  paginate,
  parsePagination,
  Errors,
  errorResponse,
} from "../lib/http";
import { sortComplaints } from "../lib/sort";
import { severityLabel } from "../lib/severity";
import { avgResolutionHours, slaLabel } from "../lib/sla";
import { cascadeClusterResolution } from "../lib/cluster";
import { awardPoints } from "../lib/points";
import {
  isOfficerTargetStatus,
  validateOfficerTransition,
  validateEvidenceReview,
  TERMINAL_STATUSES,
} from "../lib/fsm";
import { fromApiId } from "../lib/ids";
import type {
  BatchStatusUpdateRequest,
  EvidenceReviewRequest,
  ProgressNoteRequest,
  StatusUpdateRequest,
} from "../../types/api";
import type { ComplaintRow, ComplaintStatus } from "../db/types";

const BASE = "/api/v1";

const severityRank: Record<string, number> = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
const slaRank: Record<string, number> = { OVERDUE: 2, DELAYED: 1, ON_TIME: 0 };

function officerDefaultSort(a: ComplaintRow, b: ComplaintRow): number {
  const severityDiff =
    severityRank[severityLabel(b.severityScore)] -
    severityRank[severityLabel(a.severityScore)];
  if (severityDiff !== 0) return severityDiff;
  const slaA = slaLabel(
    a.slaTargetHours,
    a.slaStartedAt,
    a.slaPausedSeconds,
    a.slaPausedAt,
  );
  const slaB = slaLabel(
    b.slaTargetHours,
    b.slaStartedAt,
    b.slaPausedSeconds,
    b.slaPausedAt,
  );
  const slaDiff = (slaB ? slaRank[slaB] : -1) - (slaA ? slaRank[slaA] : -1);
  if (slaDiff !== 0) return slaDiff;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function applyOfficerTransition(
  complaint: ComplaintRow,
  target: ComplaintStatus,
  officerId: number,
  reason: string | undefined,
  note: string | undefined,
): void {
  const now = new Date().toISOString();
  const previousStatus = complaint.status;
  complaint.status = target;
  complaint.updatedAt = now;

  if (target === "RESOLVED") complaint.resolvedAt = now;
  if (target === "NEEDS_MORE_EVIDENCE" && complaint.slaStartedAt != null) {
    complaint.slaPausedAt = now;
  }

  db.statusHistory.push({
    id: nextId("statusHistory"),
    complaintId: complaint.id,
    fromStatus: previousStatus,
    toStatus: target,
    actorRole: "OFFICER",
    changedByUserId: officerId,
    reason: reason ?? null,
    remark: note ?? null,
    createdAt: now,
  });
}

export const officerHandlers = [
  http.get(`${BASE}/officer/complaints`, ({ request }) => {
    const auth = requireRole(request, "OFFICER");
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const statusFilter = url.searchParams.getAll("status");
    const categoryId = url.searchParams.get("categoryId");
    const slaFilter = url.searchParams.get("slaLabel");
    const severityFilter = url.searchParams.get("severityLabel");

    let rows = db.complaints.filter((c) => c.zoneId === auth.user.zoneId);
    if (statusFilter.length > 0)
      rows = rows.filter((c) => statusFilter.includes(c.status));
    if (categoryId) rows = rows.filter((c) => c.categoryId === fromApiId(categoryId));
    if (severityFilter)
      rows = rows.filter((c) => severityLabel(c.severityScore) === severityFilter);
    if (slaFilter) {
      rows = rows.filter(
        (c) =>
          slaLabel(
            c.slaTargetHours,
            c.slaStartedAt,
            c.slaPausedSeconds,
            c.slaPausedAt,
          ) === slaFilter,
      );
    }

    rows = sortComplaints(rows, url.searchParams.get("sort"), officerDefaultSort);
    const { data, pagination } = paginate(rows, parsePagination(url));
    return HttpResponse.json({
      data: data.map((c) => toComplaintCompact(c)),
      pagination,
    });
  }),

  http.post(`${BASE}/officer/complaints/:complaintId/claim`, ({ request, params }) => {
    const auth = requireRole(request, "OFFICER");
    if (!auth.ok) return auth.response;

    const complaint = db.complaints.find(
      (c) => c.id === fromApiId(String(params.complaintId)),
    );
    if (!complaint) return Errors.notFound();
    if (complaint.zoneId !== auth.user.zoneId) return Errors.forbidden();
    if (complaint.status !== "SUBMITTED") {
      return Errors.conflict(
        "INVALID_TRANSITION",
        "This complaint has already been claimed.",
      );
    }

    complaint.assignedOfficerId = auth.user.id;
    applyOfficerTransition(
      complaint,
      "EVIDENCE_UNDER_REVIEW",
      auth.user.id,
      undefined,
      undefined,
    );
    persist();
    return HttpResponse.json(toComplaintDetail(complaint, "OFFICER"));
  }),

  http.post(
    `${BASE}/officer/complaints/:complaintId/evidence-review`,
    async ({ request, params }) => {
      const auth = requireRole(request, "OFFICER");
      if (!auth.ok) return auth.response;

      const complaint = db.complaints.find(
        (c) => c.id === fromApiId(String(params.complaintId)),
      );
      if (!complaint) return Errors.notFound();
      if (complaint.zoneId !== auth.user.zoneId) return Errors.forbidden();

      const body = (await request.json()) as EvidenceReviewRequest;
      const check = validateEvidenceReview(
        complaint.status,
        complaint.slaStartedAt,
        body.verdict,
        body.reason,
      );
      if (!check.ok) return Errors.conflict(check.code, check.message);

      const evidenceRow = [...db.evidence]
        .filter((e) => e.complaintId === complaint.id)
        .sort((a, b) => b.sequence - a.sequence)[0];
      const now = new Date().toISOString();
      evidenceRow.verdict = body.verdict;
      evidenceRow.verdictReason = body.reason ?? null;
      evidenceRow.reviewedBy = auth.user.id;
      evidenceRow.reviewedAt = now;

      if (body.verdict === "VALID") {
        const wasFirstAcceptance = complaint.slaStartedAt == null;
        if (wasFirstAcceptance) {
          const category = db.categories.find((c) => c.id === complaint.categoryId)!;
          complaint.slaTargetHours = category.slaHours;
          complaint.slaStartedAt = now;
        }
        applyOfficerTransition(
          complaint,
          "UNDER_REVIEW",
          auth.user.id,
          undefined,
          undefined,
        );
      } else if (body.verdict === "NEEDS_MORE_EVIDENCE") {
        applyOfficerTransition(
          complaint,
          "NEEDS_MORE_EVIDENCE",
          auth.user.id,
          body.reason,
          undefined,
        );
      } else {
        complaint.status = "REJECTED";
        complaint.updatedAt = now;
        db.statusHistory.push({
          id: nextId("statusHistory"),
          complaintId: complaint.id,
          fromStatus: "EVIDENCE_UNDER_REVIEW",
          toStatus: "REJECTED",
          actorRole: "OFFICER",
          changedByUserId: auth.user.id,
          reason: body.reason ?? null,
          remark: null,
          createdAt: now,
        });
        awardPoints(complaint.citizenId, complaint.id, "REJECTED_PENALTY");
      }

      persist();
      return HttpResponse.json(toComplaintDetail(complaint, "OFFICER"));
    },
  ),

  http.patch(
    `${BASE}/officer/complaints/:complaintId/status`,
    async ({ request, params }) => {
      const auth = requireRole(request, "OFFICER");
      if (!auth.ok) return auth.response;

      const complaint = db.complaints.find(
        (c) => c.id === fromApiId(String(params.complaintId)),
      );
      if (!complaint) return Errors.notFound();
      if (complaint.zoneId !== auth.user.zoneId) return Errors.forbidden();

      const body = (await request.json()) as StatusUpdateRequest;
      if (!isOfficerTargetStatus(body.status)) {
        return Errors.badRequest(
          "status must be one of the officer-triggerable targets.",
        );
      }
      const check = validateOfficerTransition(complaint.status, body.status, body.reason);
      if (!check.ok) {
        const status = check.errorCode === "REASON_REQUIRED" ? 400 : 409;
        return errorResponse(status, check.errorCode, check.message);
      }

      applyOfficerTransition(
        complaint,
        body.status,
        auth.user.id,
        body.reason,
        body.note,
      );

      let cascade;
      if (body.status === "RESOLVED" && complaint.clusterId != null) {
        cascade = cascadeClusterResolution(complaint);
      }
      persist();

      return HttpResponse.json({
        complaint: toComplaintDetail(complaint, "OFFICER"),
        ...(cascade ? { cascade } : {}),
      });
    },
  ),

  http.post(`${BASE}/officer/complaints/batch-status`, async ({ request }) => {
    const auth = requireRole(request, "OFFICER");
    if (!auth.ok) return auth.response;

    const body = (await request.json()) as BatchStatusUpdateRequest;
    const hasIds = Array.isArray(body.complaintIds) && body.complaintIds.length > 0;
    const hasCluster = typeof body.clusterId === "string" && body.clusterId.length > 0;
    if (hasIds === hasCluster) {
      return Errors.badRequest("Provide exactly one of complaintIds or clusterId.");
    }
    if (!isOfficerTargetStatus(body.status)) {
      return Errors.badRequest("status must be one of the officer-triggerable targets.");
    }

    let targets: (ComplaintRow | null)[];
    if (hasCluster) {
      const clusterId = fromApiId(body.clusterId!);
      const cluster = db.clusters.find((c) => c.id === clusterId);
      if (!cluster) return Errors.notFound("The supplied clusterId does not exist.");
      targets = db.complaints.filter((c) => c.clusterId === clusterId);
    } else {
      targets = body.complaintIds!.map(
        (id) => db.complaints.find((c) => c.id === fromApiId(id)) ?? null,
      );
    }

    const results = targets.map((complaint, index) => {
      if (!complaint) {
        return {
          complaintId: body.complaintIds![index],
          success: false,
          status: null,
          previousStatus: null,
          errorCode: "UNKNOWN_COMPLAINT" as const,
          errorMessage: "No complaint with this ID exists.",
        };
      }
      if (complaint.zoneId !== auth.user.zoneId) {
        return {
          complaintId: String(complaint.id),
          success: false,
          status: null,
          previousStatus: complaint.status,
          errorCode: "NOT_IN_ZONE" as const,
          errorMessage: "This complaint is outside your assigned zone.",
        };
      }
      const check = validateOfficerTransition(complaint.status, body.status, body.reason);
      if (!check.ok) {
        return {
          complaintId: String(complaint.id),
          success: false,
          status: null,
          previousStatus: complaint.status,
          errorCode: check.errorCode,
          errorMessage: check.message,
        };
      }
      const previousStatus = complaint.status;
      // Batch updates never cascade (unlike the single-item endpoint) — every
      // item is validated and applied against its own current status only.
      applyOfficerTransition(
        complaint,
        body.status,
        auth.user.id,
        body.reason,
        body.note,
      );
      return {
        complaintId: String(complaint.id),
        success: true,
        status: complaint.status,
        previousStatus,
        errorCode: null,
        errorMessage: null,
      };
    });

    persist();
    const succeeded = results.filter((r) => r.success).length;
    return HttpResponse.json({
      results,
      summary: {
        requested: results.length,
        succeeded,
        failed: results.length - succeeded,
      },
    });
  }),

  http.post(
    `${BASE}/officer/complaints/:complaintId/notes`,
    async ({ request, params }) => {
      const auth = requireRole(request, "OFFICER");
      if (!auth.ok) return auth.response;

      const complaint = db.complaints.find(
        (c) => c.id === fromApiId(String(params.complaintId)),
      );
      if (!complaint) return Errors.notFound();
      if (complaint.zoneId !== auth.user.zoneId) return Errors.forbidden();
      if (complaint.status !== "IN_PROGRESS" && complaint.status !== "UNDER_RESOLUTION") {
        return Errors.conflict(
          "INVALID_TRANSITION",
          "Notes can only be added while a complaint is IN_PROGRESS or UNDER_RESOLUTION.",
        );
      }

      const body = (await request.json()) as ProgressNoteRequest;
      if (!body.text?.trim() || body.text.length > 500) {
        return Errors.badRequest(
          "Note text is required and must be 500 characters or fewer.",
        );
      }

      const note = {
        id: nextId("notes"),
        complaintId: complaint.id,
        officerId: auth.user.id,
        noteText: body.text.trim(),
        createdAt: new Date().toISOString(),
      };
      db.notes.push(note);
      persist();
      return HttpResponse.json(
        {
          id: String(note.id),
          officerId: String(note.officerId),
          text: note.noteText,
          createdAt: note.createdAt,
        },
        { status: 201 },
      );
    },
  ),

  http.post(`${BASE}/officer/clusters/:clusterId/notes`, async ({ request, params }) => {
    const auth = requireRole(request, "OFFICER");
    if (!auth.ok) return auth.response;

    const cluster = db.clusters.find((c) => c.id === fromApiId(String(params.clusterId)));
    if (!cluster) return Errors.notFound();
    if (cluster.zoneId !== auth.user.zoneId) return Errors.forbidden();

    const body = (await request.json()) as ProgressNoteRequest;
    if (!body.text?.trim() || body.text.length > 500) {
      return Errors.badRequest(
        "Note text is required and must be 500 characters or fewer.",
      );
    }

    const eligible = db.complaints.filter(
      (c) =>
        c.clusterId === cluster.id &&
        (c.status === "IN_PROGRESS" || c.status === "UNDER_RESOLUTION"),
    );
    if (eligible.length === 0) {
      return Errors.conflict(
        "INVALID_TRANSITION",
        "No complaint in this cluster is IN_PROGRESS or UNDER_RESOLUTION.",
      );
    }

    const created = eligible.map((complaint) => {
      const note = {
        id: nextId("notes"),
        complaintId: complaint.id,
        officerId: auth.user.id,
        noteText: body.text.trim(),
        createdAt: new Date().toISOString(),
      };
      db.notes.push(note);
      return {
        id: String(note.id),
        officerId: String(note.officerId),
        text: note.noteText,
        createdAt: note.createdAt,
      };
    });
    persist();
    return HttpResponse.json(created, { status: 201 });
  }),

  http.get(`${BASE}/officer/analytics`, ({ request }) => {
    const auth = requireRole(request, "OFFICER");
    if (!auth.ok) return auth.response;

    const zone = db.zones.find((z) => z.id === auth.user.zoneId)!;
    const url = new URL(request.url);
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");

    // The contract declares dateFrom/dateTo on this endpoint; they narrow the
    // sample by when a complaint was *filed*. Note this deliberately does not
    // touch avgResolutionHoursThisMonth below — that field is pinned by the
    // contract to the current calendar month whatever range is requested.
    const allZoneRows = db.complaints.filter((c) => c.zoneId === zone.id);
    let rows = allZoneRows;
    if (dateFrom) rows = rows.filter((c) => new Date(c.createdAt) >= new Date(dateFrom));
    if (dateTo) rows = rows.filter((c) => new Date(c.createdAt) <= new Date(dateTo));

    const active = rows.filter((c) => !TERMINAL_STATUSES.has(c.status));
    const overdue = rows.filter(
      (c) =>
        slaLabel(c.slaTargetHours, c.slaStartedAt, c.slaPausedSeconds, c.slaPausedAt) ===
        "OVERDUE",
    );

    const now = new Date();
    const resolvedThisMonth = allZoneRows.filter(
      (c) =>
        c.resolvedAt &&
        new Date(c.resolvedAt).getMonth() === now.getMonth() &&
        new Date(c.resolvedAt).getFullYear() === now.getFullYear(),
    );
    const avgResolutionHoursThisMonth = avgResolutionHours(resolvedThisMonth);

    const categoryBreakdown = db.categories
      .map((category) => ({
        categoryId: String(category.id),
        categoryName: category.categoryName,
        count: rows.filter((c) => c.categoryId === category.id).length,
      }))
      .filter((c) => c.count > 0);

    return HttpResponse.json({
      zoneId: String(zone.id),
      zoneName: zone.zoneName,
      activeComplaints: active.length,
      overdueCount: overdue.length,
      avgResolutionHoursThisMonth,
      categoryBreakdown,
    });
  }),
];
