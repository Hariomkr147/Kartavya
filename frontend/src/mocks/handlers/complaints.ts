import { http, HttpResponse } from "msw";
import { db, persist, nextId } from "../db/store";
import { toComplaintDetail } from "../serializers";
import { requireRole, requireAuth, paginate, parsePagination, Errors } from "../lib/http";
import { sortComplaints } from "../lib/sort";
import { validateAndStorePhoto } from "../lib/upload";
import { simulateEvidenceScreening } from "../lib/ai";
import { linkComplaintToCluster, recomputeSeverity } from "../lib/cluster";
import { awardPoints, checkAndAwardBadges } from "../lib/points";
import { slaLabel } from "../lib/sla";
import { severityLabel } from "../lib/severity";
import { generateComplaintCode, fromApiId } from "../lib/ids";
import type { ComplaintStatus } from "../db/types";

const BASE = "/api/v1";

export const complaintsHandlers = [
  http.post(`${BASE}/complaints`, async ({ request }) => {
    const auth = requireRole(request, "CITIZEN");
    if (!auth.ok) return auth.response;

    const form = await request.formData();
    const categoryId = fromApiId(String(form.get("categoryId") ?? ""));
    const zoneId = fromApiId(String(form.get("zoneId") ?? ""));
    const latitudeRaw = form.get("latitude");
    const longitudeRaw = form.get("longitude");
    const latitude = typeof latitudeRaw === "string" ? Number(latitudeRaw) : NaN;
    const longitude = typeof longitudeRaw === "string" ? Number(longitudeRaw) : NaN;
    const description = form.get("description");
    const photos = form.getAll("photos").filter((p): p is File => p instanceof File);

    if (categoryId == null || !db.categories.some((c) => c.id === categoryId)) {
      return Errors.badRequest("categoryId does not refer to a known category.");
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return Errors.badRequest("latitude and longitude are required.");
    }
    const zone = zoneId != null ? db.zones.find((z) => z.id === zoneId) : undefined;
    if (!zone) {
      return Errors.badRequest("zoneId does not refer to a known zone.");
    }
    if (!zone.isActive) {
      return Errors.badRequest("This zone is no longer accepting new complaints.");
    }
    if (photos.length === 0) {
      return Errors.badRequest("At least one photo is required.");
    }
    if (photos.length > 3) {
      return Errors.badRequest("At most 3 photos are allowed.");
    }
    const photoChecks = photos.map((p) => validateAndStorePhoto(p));
    const firstBad = photoChecks.find((p) => !p.ok);
    if (firstBad && !firstBad.ok) return Errors.badRequest(firstBad.message);

    const now = new Date().toISOString();
    const complaintId = nextId("complaints");
    const complaint = {
      id: complaintId,
      complaintCode: generateComplaintCode(complaintId),
      citizenId: auth.user.id,
      zoneId: zone.id,
      categoryId,
      clusterId: null,
      assignedOfficerId: null,
      description:
        typeof description === "string" && description.trim() ? description.trim() : null,
      latitude,
      longitude,
      status: "SUBMITTED" as ComplaintStatus,
      severityScore: 0,
      slaTargetHours: null,
      slaStartedAt: null,
      slaPausedSeconds: 0,
      slaPausedAt: null,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      closedAt: null,
    };
    db.complaints.push(complaint);

    const evidenceIds = photoChecks.map((check, index) => {
      const evidenceId = nextId("evidence");
      db.evidence.push({
        id: evidenceId,
        complaintId: complaint.id,
        sequence: index + 1,
        filePath: check.ok ? check.url : "",
        aiScreenStatus: "PENDING",
        aiMatchesCategory: null,
        aiConfidence: null,
        aiNote: null,
        verdict: null,
        verdictReason: null,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: now,
      });
      return evidenceId;
    });

    db.statusHistory.push({
      id: nextId("statusHistory"),
      complaintId: complaint.id,
      fromStatus: null,
      toStatus: "SUBMITTED",
      actorRole: "CITIZEN",
      changedByUserId: auth.user.id,
      reason: null,
      remark: null,
      createdAt: now,
    });

    linkComplaintToCluster(complaint);

    const isFirstComplaint =
      db.complaints.filter((c) => c.citizenId === auth.user.id).length === 1;
    if (isFirstComplaint) {
      awardPoints(auth.user.id, complaint.id, "FIRST_COMPLAINT");
    } else {
      checkAndAwardBadges(auth.user.id);
    }

    persist();
    const categoryName = db.categories.find((c) => c.id === categoryId)!.categoryName;
    evidenceIds.forEach((evidenceId) => simulateEvidenceScreening(evidenceId, categoryName));

    return HttpResponse.json(toComplaintDetail(complaint, "CITIZEN", auth.user.id), {
      status: 201,
    });
  }),

  http.get(`${BASE}/complaints/my`, ({ request }) => {
    const auth = requireRole(request, "CITIZEN");
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const statusFilter = url.searchParams.getAll("status");
    const categoryId = url.searchParams.get("categoryId");

    let rows = db.complaints.filter((c) => c.citizenId === auth.user.id);
    if (statusFilter.length > 0)
      rows = rows.filter((c) => statusFilter.includes(c.status));
    if (categoryId) rows = rows.filter((c) => c.categoryId === fromApiId(categoryId));

    rows = sortComplaints(
      rows,
      url.searchParams.get("sort"),
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const { data, pagination } = paginate(rows, parsePagination(url));
    return HttpResponse.json({
      data: data.map((c) => toComplaintDetail(c, "CITIZEN", auth.user.id)),
      pagination,
    });
  }),

  http.get(`${BASE}/complaints/:complaintId`, ({ request, params }) => {
    const auth = requireAuth(request);
    if (!auth.ok) return auth.response;

    const complaint = db.complaints.find(
      (c) => c.id === fromApiId(String(params.complaintId)),
    );
    if (!complaint) return Errors.notFound();

    if (auth.user.role === "CITIZEN") {
      if (complaint.citizenId !== auth.user.id) return Errors.forbidden();
    } else if (auth.user.role === "OFFICER") {
      if (complaint.zoneId !== auth.user.zoneId) return Errors.forbidden();
    }
    return HttpResponse.json(toComplaintDetail(complaint, auth.user.role, auth.user.id));
  }),

  http.post(`${BASE}/complaints/:complaintId/evidence`, async ({ request, params }) => {
    const auth = requireRole(request, "CITIZEN");
    if (!auth.ok) return auth.response;

    const complaint = db.complaints.find(
      (c) => c.id === fromApiId(String(params.complaintId)),
    );
    if (!complaint) return Errors.notFound();
    if (complaint.citizenId !== auth.user.id) return Errors.forbidden();
    if (complaint.status !== "NEEDS_MORE_EVIDENCE") {
      return Errors.conflict(
        "INVALID_TRANSITION",
        "This complaint is not awaiting more evidence right now.",
      );
    }

    const form = await request.formData();
    const photoCheck = validateAndStorePhoto(
      form.get("photo") instanceof File ? (form.get("photo") as File) : null,
    );
    if (!photoCheck.ok) return Errors.badRequest(photoCheck.message);

    const now = new Date().toISOString();
    const wasPostAcceptance = complaint.slaStartedAt !== null;
    const nextSequence =
      Math.max(
        ...db.evidence
          .filter((e) => e.complaintId === complaint.id)
          .map((e) => e.sequence),
      ) + 1;
    const evidenceId = nextId("evidence");
    db.evidence.push({
      id: evidenceId,
      complaintId: complaint.id,
      sequence: nextSequence,
      filePath: photoCheck.url,
      aiScreenStatus: "PENDING",
      aiMatchesCategory: null,
      aiConfidence: null,
      aiNote: null,
      verdict: null,
      verdictReason: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: now,
    });

    // Resume the SLA clock if this was a post-acceptance recall (pre-acceptance
    // NEEDS_MORE_EVIDENCE never paused anything — the clock hadn't started).
    if (wasPostAcceptance && complaint.slaPausedAt) {
      const pausedMs = Date.now() - new Date(complaint.slaPausedAt).getTime();
      complaint.slaPausedSeconds += pausedMs / 1000;
      complaint.slaPausedAt = null;
    }

    const previousStatus = complaint.status;
    complaint.status = "EVIDENCE_UNDER_REVIEW";
    complaint.updatedAt = now;
    db.statusHistory.push({
      id: nextId("statusHistory"),
      complaintId: complaint.id,
      fromStatus: previousStatus,
      toStatus: "EVIDENCE_UNDER_REVIEW",
      actorRole: "CITIZEN",
      changedByUserId: auth.user.id,
      reason: null,
      remark: null,
      createdAt: now,
    });

    persist();
    simulateEvidenceScreening(
      evidenceId,
      db.categories.find((c) => c.id === complaint.categoryId)!.categoryName,
    );
    return HttpResponse.json(toComplaintDetail(complaint, "CITIZEN", auth.user.id), {
      status: 201,
    });
  }),

  http.post(`${BASE}/complaints/:complaintId/upvote`, ({ request, params }) => {
    const auth = requireRole(request, "CITIZEN");
    if (!auth.ok) return auth.response;

    const complaint = db.complaints.find(
      (c) => c.id === fromApiId(String(params.complaintId)),
    );
    if (!complaint) return Errors.notFound();
    if (complaint.citizenId === auth.user.id) {
      return Errors.forbidden("You cannot upvote your own complaint.");
    }
    if (complaint.zoneId !== auth.user.zoneId) {
      return Errors.forbidden("You cannot upvote a complaint outside your zone.");
    }
    if (complaint.status === "CLOSED") {
      return Errors.conflict("ALREADY_CLOSED", "This complaint is already closed.");
    }
    if (
      db.upvotes.some(
        (u) => u.complaintId === complaint.id && u.citizenId === auth.user.id,
      )
    ) {
      return Errors.conflict(
        "ALREADY_UPVOTED",
        "You have already upvoted this complaint.",
      );
    }

    db.upvotes.push({
      id: nextId("upvotes"),
      complaintId: complaint.id,
      citizenId: auth.user.id,
      createdAt: new Date().toISOString(),
    });
    recomputeSeverity(complaint);
    awardPoints(complaint.citizenId, complaint.id, "UPVOTE_RECEIVED");
    persist();

    const upvoteCount = db.upvotes.filter((u) => u.complaintId === complaint.id).length;
    return HttpResponse.json({
      complaintId: String(complaint.id),
      upvoteCount,
      severityLabel: severityLabel(complaint.severityScore),
    });
  }),

  http.post(`${BASE}/complaints/:complaintId/confirm`, ({ request, params }) => {
    const auth = requireRole(request, "CITIZEN");
    if (!auth.ok) return auth.response;

    const complaint = db.complaints.find(
      (c) => c.id === fromApiId(String(params.complaintId)),
    );
    if (!complaint) return Errors.notFound();
    if (complaint.citizenId !== auth.user.id) return Errors.forbidden();
    if (complaint.status !== "RESOLVED") {
      return Errors.conflict(
        "INVALID_TRANSITION",
        "This complaint is not awaiting confirmation.",
      );
    }

    const now = new Date().toISOString();
    const onTime =
      complaint.slaTargetHours != null && complaint.slaStartedAt != null
        ? slaLabel(
            complaint.slaTargetHours,
            complaint.slaStartedAt,
            complaint.slaPausedSeconds,
            complaint.slaPausedAt,
            new Date(now),
          ) === "ON_TIME"
        : false;

    complaint.status = "CLOSED";
    complaint.closedAt = now;
    complaint.updatedAt = now;
    db.statusHistory.push({
      id: nextId("statusHistory"),
      complaintId: complaint.id,
      fromStatus: "RESOLVED",
      toStatus: "CLOSED",
      actorRole: "CITIZEN",
      changedByUserId: auth.user.id,
      reason: null,
      remark: null,
      createdAt: now,
    });

    if (complaint.clusterId != null) {
      const cluster = db.clusters.find((c) => c.id === complaint.clusterId)!;
      const alreadyRewardedInCluster = db.pointsLedger.some(
        (p) =>
          p.citizenId === auth.user.id &&
          (p.reason === "COMPLAINT_CLOSED" || p.reason === "CLUSTER_MEMBER_CLOSED") &&
          p.complaintId != null &&
          db.complaints.find((c) => c.id === p.complaintId)?.clusterId ===
            complaint.clusterId,
      );
      if (!alreadyRewardedInCluster) {
        if (!cluster.rewardGranted) {
          awardPoints(auth.user.id, complaint.id, "COMPLAINT_CLOSED");
          cluster.rewardGranted = true;
        } else {
          awardPoints(auth.user.id, complaint.id, "CLUSTER_MEMBER_CLOSED");
        }
      }
    } else {
      awardPoints(auth.user.id, complaint.id, "COMPLAINT_CLOSED");
    }
    if (onTime) awardPoints(auth.user.id, complaint.id, "ON_TIME_BONUS");
    checkAndAwardBadges(auth.user.id);

    persist();
    return HttpResponse.json(toComplaintDetail(complaint, "CITIZEN", auth.user.id));
  }),

  http.post(`${BASE}/complaints/:complaintId/dispute`, async ({ request, params }) => {
    const auth = requireRole(request, "CITIZEN");
    if (!auth.ok) return auth.response;

    const complaint = db.complaints.find(
      (c) => c.id === fromApiId(String(params.complaintId)),
    );
    if (!complaint) return Errors.notFound();
    if (complaint.citizenId !== auth.user.id) return Errors.forbidden();
    if (complaint.status !== "RESOLVED") {
      return Errors.conflict(
        "INVALID_TRANSITION",
        "This complaint is not awaiting confirmation.",
      );
    }

    const form = await request.formData();
    const reason = String(form.get("reason") ?? "").trim();
    const photoCheck = validateAndStorePhoto(
      form.get("photo") instanceof File ? (form.get("photo") as File) : null,
    );
    if (!reason)
      return Errors.badRequest("A reason is required to dispute a resolution.");
    if (!photoCheck.ok) return Errors.badRequest(photoCheck.message);

    const now = new Date().toISOString();
    const nextSequence =
      Math.max(
        ...db.evidence
          .filter((e) => e.complaintId === complaint.id)
          .map((e) => e.sequence),
      ) + 1;
    db.evidence.push({
      id: nextId("evidence"),
      complaintId: complaint.id,
      sequence: nextSequence,
      filePath: photoCheck.url,
      aiScreenStatus: "UNAVAILABLE", // dispute evidence never goes through officer evidence-review/AI pre-screening
      aiMatchesCategory: null,
      aiConfidence: null,
      aiNote: null,
      verdict: null,
      verdictReason: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: now,
    });

    complaint.status = "REOPENED";
    complaint.updatedAt = now;
    db.statusHistory.push({
      id: nextId("statusHistory"),
      complaintId: complaint.id,
      fromStatus: "RESOLVED",
      toStatus: "REOPENED",
      actorRole: "CITIZEN",
      changedByUserId: auth.user.id,
      reason,
      remark: null,
      createdAt: now,
    });

    persist();
    return HttpResponse.json(toComplaintDetail(complaint, "CITIZEN", auth.user.id));
  }),
];
