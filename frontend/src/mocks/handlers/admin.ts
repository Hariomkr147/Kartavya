import { http, HttpResponse } from "msw";
import { db, persist, nextId } from "../db/store";
import {
  toComplaintDetail,
  toComplaintCompact,
  toUser,
  toCategory,
  toZone,
} from "../serializers";
import { requireRole, paginate, parsePagination, Errors } from "../lib/http";
import { sortComplaints } from "../lib/sort";
import { severityLabel } from "../lib/severity";
import { avgResolutionHours, slaLabel } from "../lib/sla";
import { lifetimePoints } from "../lib/points";
import { TERMINAL_STATUSES, AT_OR_PAST_UNDER_REVIEW } from "../lib/fsm";
import { reassignComplaintCluster, exitClusterIfTerminal } from "../lib/cluster";
import { fromApiId, toApiId } from "../lib/ids";
import { toCsv } from "../lib/csv";
import { simulateAiZoneReportGeneration } from "../lib/ai";
import type {
  ComplaintOverrideRequest,
  DisputeReviewRequest,
  CreateUserRequest,
  UpdateUserRequest,
  CreateZoneRequest,
  UpdateZoneRequest,
  AssignOfficerRequest,
  SlaUpdateRequest,
  Settings,
} from "../../types/api";

const BASE = "/api/v1";

/** Clears assignedOfficerId on an officer's non-terminal complaints in `oldZoneId` — they can no longer see them. */
function clearAssignmentsForZoneChange(officerId: number, oldZoneId: number): void {
  for (const complaint of db.complaints) {
    if (
      complaint.assignedOfficerId === officerId &&
      complaint.zoneId === oldZoneId &&
      !TERMINAL_STATUSES.has(complaint.status)
    ) {
      complaint.assignedOfficerId = null;
    }
  }
}

export const adminHandlers = [
  // --- Complaints (cross-zone) ---
  http.get(`${BASE}/admin/complaints`, ({ request }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const zoneId = url.searchParams.get("zoneId");
    const categoryId = url.searchParams.get("categoryId");
    const statusFilter = url.searchParams.getAll("status");
    const slaFilter = url.searchParams.get("slaLabel");
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");

    let rows = db.complaints;
    if (zoneId) rows = rows.filter((c) => c.zoneId === fromApiId(zoneId));
    if (categoryId) rows = rows.filter((c) => c.categoryId === fromApiId(categoryId));
    if (statusFilter.length > 0)
      rows = rows.filter((c) => statusFilter.includes(c.status));
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
    if (dateFrom) rows = rows.filter((c) => new Date(c.createdAt) >= new Date(dateFrom));
    if (dateTo) rows = rows.filter((c) => new Date(c.createdAt) <= new Date(dateTo));

    rows = sortComplaints(
      rows,
      url.searchParams.get("sort"),
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const { data, pagination } = paginate(rows, parsePagination(url));
    return HttpResponse.json({
      data: data.map((c) => toComplaintCompact(c)),
      pagination,
    });
  }),

  http.patch(`${BASE}/admin/complaints/:complaintId`, async ({ request, params }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;

    const complaint = db.complaints.find(
      (c) => c.id === fromApiId(String(params.complaintId)),
    );
    if (!complaint) return Errors.notFound();

    const body = (await request.json()) as ComplaintOverrideRequest;
    const now = new Date().toISOString();

    let categoryOrZoneChanged = false;
    if (body.categoryId !== undefined) {
      const categoryId = fromApiId(body.categoryId);
      if (categoryId == null || !db.categories.some((c) => c.id === categoryId)) {
        return Errors.badRequest("categoryId does not refer to a known category.");
      }
      if (categoryId !== complaint.categoryId) categoryOrZoneChanged = true;
      complaint.categoryId = categoryId;
    }
    if (body.zoneId !== undefined) {
      const zoneId = fromApiId(body.zoneId);
      const zone = zoneId != null ? db.zones.find((z) => z.id === zoneId) : undefined;
      if (!zone) return Errors.badRequest("zoneId does not refer to a known zone.");
      if (zone.id !== complaint.zoneId) categoryOrZoneChanged = true;
      complaint.zoneId = zone.id;
    }
    // Clusters are strictly same-category/same-zone — a category/zone edit
    // must re-place the complaint rather than leave it in a now-mismatched
    // cluster (or stranded standalone when it newly matches one).
    if (categoryOrZoneChanged) reassignComplaintCluster(complaint);

    if (body.status !== undefined) {
      const previousStatus = complaint.status;
      complaint.status = body.status;
      exitClusterIfTerminal(complaint);
      complaint.updatedAt = now;
      if (body.status === "RESOLVED") complaint.resolvedAt = now;
      if (body.status === "CLOSED") complaint.closedAt = now;

      // SLA backfill: an override that force-jumps to UNDER_REVIEW or later
      // must not leave slaLabel silently null.
      if (AT_OR_PAST_UNDER_REVIEW.has(body.status) && complaint.slaStartedAt == null) {
        const category = db.categories.find((c) => c.id === complaint.categoryId)!;
        complaint.slaTargetHours = category.slaHours;
        complaint.slaStartedAt = now;
      }

      db.statusHistory.push({
        id: nextId("statusHistory"),
        complaintId: complaint.id,
        fromStatus: previousStatus,
        toStatus: body.status,
        actorRole: "ADMIN",
        changedByUserId: auth.user.id,
        reason: body.reason ?? null,
        remark: null,
        createdAt: now,
      });
    }

    persist();
    return HttpResponse.json(toComplaintDetail(complaint, "ADMIN"));
  }),

  http.post(
    `${BASE}/admin/complaints/:complaintId/dispute-review`,
    async ({ request, params }) => {
      const auth = requireRole(request, "ADMIN");
      if (!auth.ok) return auth.response;

      const complaint = db.complaints.find(
        (c) => c.id === fromApiId(String(params.complaintId)),
      );
      if (!complaint) return Errors.notFound();
      if (complaint.status !== "REOPENED") {
        return Errors.conflict(
          "INVALID_TRANSITION",
          "This complaint is not currently REOPENED.",
        );
      }

      const body = (await request.json()) as DisputeReviewRequest;
      if (!body.verdict || !body.reason?.trim()) {
        return Errors.badRequest("verdict and reason are both required.");
      }

      const now = new Date().toISOString();
      if (body.verdict === "UPHELD") {
        complaint.status = "IN_PROGRESS";
        complaint.updatedAt = now;
        db.statusHistory.push({
          id: nextId("statusHistory"),
          complaintId: complaint.id,
          fromStatus: "REOPENED",
          toStatus: "IN_PROGRESS",
          actorRole: "ADMIN",
          changedByUserId: auth.user.id,
          reason: body.reason,
          remark: null,
          createdAt: now,
        });
      } else {
        complaint.status = "CLOSED";
        exitClusterIfTerminal(complaint);
        complaint.closedAt = now;
        complaint.updatedAt = now;
        db.statusHistory.push({
          id: nextId("statusHistory"),
          complaintId: complaint.id,
          fromStatus: "REOPENED",
          toStatus: "CLOSED",
          actorRole: "ADMIN",
          changedByUserId: auth.user.id,
          reason: body.reason,
          remark: null,
          createdAt: now,
        });
        // No points — same as an auto-close. A citizen cannot use a losing
        // dispute to manufacture a second shot at the confirm reward.
      }

      persist();
      return HttpResponse.json(toComplaintDetail(complaint, "ADMIN"));
    },
  ),

  // --- Users ---
  http.get(`${BASE}/admin/users`, ({ request }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    const zoneId = url.searchParams.get("zoneId");
    const active = url.searchParams.get("active");

    let rows = db.users;
    if (role) rows = rows.filter((u) => u.role === role);
    if (zoneId) rows = rows.filter((u) => u.zoneId === fromApiId(zoneId));
    if (active !== null) rows = rows.filter((u) => u.isActive === (active === "true"));

    const { data, pagination } = paginate(rows, parsePagination(url));
    return HttpResponse.json({ data: data.map(toUser), pagination });
  }),

  http.post(`${BASE}/admin/users`, async ({ request }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;

    const body = (await request.json()) as CreateUserRequest;
    if (!body.role || !body.name?.trim() || !body.email?.trim() || !body.password) {
      return Errors.badRequest("role, name, email, and password are all required.");
    }
    if (body.password.length < 8) {
      return Errors.badRequest("Password must be at least 8 characters.");
    }
    if (db.users.some((u) => u.email.toLowerCase() === body.email.toLowerCase())) {
      return HttpResponse.json(
        {
          error: {
            code: "EMAIL_TAKEN",
            message: "An account with this email already exists.",
          },
        },
        { status: 409 },
      );
    }
    let zoneId: number | null = null;
    if (body.role === "OFFICER") {
      zoneId = body.zoneId != null ? fromApiId(body.zoneId) : null;
      if (zoneId == null || !db.zones.some((z) => z.id === zoneId)) {
        return Errors.badRequest("An OFFICER requires exactly one valid zoneId.");
      }
    } else if (body.zoneId != null) {
      zoneId = fromApiId(body.zoneId);
      if (zoneId == null || !db.zones.some((z) => z.id === zoneId)) {
        return Errors.badRequest("zoneId does not refer to a known zone.");
      }
    }

    const user = {
      id: nextId("users"),
      fullName: body.name.trim(),
      displayName: null,
      email: body.email.trim(),
      password: body.password,
      role: body.role,
      zoneId,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    persist();
    return HttpResponse.json(toUser(user), { status: 201 });
  }),

  http.get(`${BASE}/admin/users/:userId`, ({ request, params }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;
    const user = db.users.find((u) => u.id === fromApiId(String(params.userId)));
    if (!user) return Errors.notFound();
    return HttpResponse.json(toUser(user));
  }),

  http.patch(`${BASE}/admin/users/:userId`, async ({ request, params }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;

    const user = db.users.find((u) => u.id === fromApiId(String(params.userId)));
    if (!user) return Errors.notFound();

    const body = (await request.json()) as UpdateUserRequest;
    if (body.email && body.email.toLowerCase() !== user.email.toLowerCase()) {
      if (
        db.users.some(
          (u) => u.id !== user.id && u.email.toLowerCase() === body.email!.toLowerCase(),
        )
      ) {
        return HttpResponse.json(
          {
            error: {
              code: "EMAIL_TAKEN",
              message: "The new email is already taken by another account.",
            },
          },
          { status: 409 },
        );
      }
      user.email = body.email.trim();
    }
    if (body.name !== undefined) user.fullName = body.name.trim();
    if (body.active !== undefined) user.isActive = body.active;
    if (body.zoneId !== undefined) {
      const newZoneId = fromApiId(body.zoneId);
      if (newZoneId == null || !db.zones.some((z) => z.id === newZoneId)) {
        return Errors.badRequest("zoneId does not refer to a known zone.");
      }
      if (user.role === "OFFICER" && user.zoneId != null && user.zoneId !== newZoneId) {
        clearAssignmentsForZoneChange(user.id, user.zoneId);
      }
      user.zoneId = newZoneId;
    }

    persist();
    return HttpResponse.json(toUser(user));
  }),

  http.delete(`${BASE}/admin/users/:userId`, ({ request, params }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;

    const user = db.users.find((u) => u.id === fromApiId(String(params.userId)));
    if (!user) return Errors.notFound();

    const hasLinkedRecords =
      db.complaints.some(
        (c) => c.citizenId === user.id || c.assignedOfficerId === user.id,
      ) ||
      db.statusHistory.some((h) => h.changedByUserId === user.id) ||
      db.notes.some((n) => n.officerId === user.id) ||
      db.pointsLedger.some((p) => p.citizenId === user.id) ||
      db.evidence.some((e) => e.reviewedBy === user.id) ||
      db.citizenBadges.some((b) => b.citizenId === user.id) ||
      db.aiZoneReports.some((r) => r.requestedBy === user.id) ||
      db.appSettings.updatedBy === user.id;

    if (hasLinkedRecords) {
      return Errors.conflict(
        "HAS_LINKED_RECORDS",
        "This account has linked records and cannot be hard-deleted. Deactivate it instead.",
      );
    }

    db.users = db.users.filter((u) => u.id !== user.id);
    persist();
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Zones ---
  http.post(`${BASE}/admin/zones`, async ({ request }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;

    const body = (await request.json()) as CreateZoneRequest;
    if (
      !body.code?.trim() ||
      !body.name?.trim() ||
      typeof body.centerLat !== "number" ||
      typeof body.centerLng !== "number"
    ) {
      return Errors.badRequest("code, name, centerLat, and centerLng are all required.");
    }
    if (db.zones.some((z) => z.zoneCode === body.code)) {
      return HttpResponse.json(
        {
          error: {
            code: "ZONE_CODE_TAKEN",
            message: "A zone with this code already exists.",
          },
        },
        { status: 409 },
      );
    }

    const zone = {
      id: nextId("zones"),
      zoneCode: body.code.trim(),
      zoneName: body.name.trim(),
      centerLat: body.centerLat,
      centerLng: body.centerLng,
      isCatchAll: false,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    db.zones.push(zone);
    persist();
    return HttpResponse.json(toZone(zone), { status: 201 });
  }),

  http.patch(`${BASE}/admin/zones/:zoneId`, async ({ request, params }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;

    const zone = db.zones.find((z) => z.id === fromApiId(String(params.zoneId)));
    if (!zone) return Errors.notFound();

    const body = (await request.json()) as UpdateZoneRequest;
    if (body.name !== undefined) zone.zoneName = body.name.trim();
    if (body.isActive !== undefined) zone.isActive = body.isActive;

    persist();
    return HttpResponse.json(toZone(zone));
  }),

  http.delete(`${BASE}/admin/zones/:zoneId`, ({ request, params }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;

    const zone = db.zones.find((z) => z.id === fromApiId(String(params.zoneId)));
    if (!zone) return Errors.notFound();

    const inUse =
      zone.isCatchAll ||
      db.complaints.some((c) => c.zoneId === zone.id) ||
      db.users.some((u) => u.zoneId === zone.id);
    if (inUse) {
      return Errors.conflict(
        "ZONE_IN_USE",
        "This zone has complaints, assigned officers, or citizens whose home zone is this one (or it is the catch-all) and cannot be deleted.",
      );
    }

    db.zones = db.zones.filter((z) => z.id !== zone.id);
    persist();
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${BASE}/admin/zones/:zoneId/assign-officer`, async ({ request, params }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;

    const zone = db.zones.find((z) => z.id === fromApiId(String(params.zoneId)));
    if (!zone) return Errors.notFound();

    const body = (await request.json()) as AssignOfficerRequest;
    const officer =
      body.officerId != null
        ? db.users.find((u) => u.id === fromApiId(body.officerId))
        : undefined;
    if (!officer || officer.role !== "OFFICER") {
      return Errors.badRequest("officerId does not refer to a known officer.");
    }

    if (officer.zoneId != null && officer.zoneId !== zone.id) {
      clearAssignmentsForZoneChange(officer.id, officer.zoneId);
    }
    officer.zoneId = zone.id;
    persist();
    return HttpResponse.json(toUser(officer));
  }),

  // --- SLAs & settings ---
  http.patch(`${BASE}/admin/slas/:categoryId`, async ({ request, params }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;

    const category = db.categories.find(
      (c) => c.id === fromApiId(String(params.categoryId)),
    );
    if (!category) return Errors.notFound();

    const body = (await request.json()) as SlaUpdateRequest;
    if (!Number.isInteger(body.targetHours) || body.targetHours < 1) {
      return Errors.badRequest("targetHours must be an integer of at least 1.");
    }
    category.slaHours = body.targetHours;
    persist();
    return HttpResponse.json(toCategory(category));
  }),

  http.get(`${BASE}/admin/settings`, ({ request }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;
    return HttpResponse.json({
      autoCloseTimeoutHours: db.appSettings.autoCloseTimeoutHours,
    });
  }),

  http.patch(`${BASE}/admin/settings`, async ({ request }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;

    const body = (await request.json()) as Settings;
    if (!Number.isInteger(body.autoCloseTimeoutHours) || body.autoCloseTimeoutHours < 1) {
      return Errors.badRequest("autoCloseTimeoutHours must be an integer of at least 1.");
    }
    db.appSettings.autoCloseTimeoutHours = body.autoCloseTimeoutHours;
    db.appSettings.updatedBy = auth.user.id;
    db.appSettings.updatedAt = new Date().toISOString();
    persist();
    return HttpResponse.json({
      autoCloseTimeoutHours: db.appSettings.autoCloseTimeoutHours,
    });
  }),

  // --- Analytics, officer performance, AI reports, export ---
  http.get(`${BASE}/admin/analytics`, ({ request }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;

    const now = new Date();
    const zoneStats = db.zones.map((zone) => {
      const rows = db.complaints.filter((c) => c.zoneId === zone.id);
      const overdue = rows.filter(
        (c) =>
          slaLabel(
            c.slaTargetHours,
            c.slaStartedAt,
            c.slaPausedSeconds,
            c.slaPausedAt,
          ) === "OVERDUE",
      ).length;
      // Anchored on resolvedAt, not closedAt: the count and the average beside
      // it must describe one population (ZoneMetrics.avgResolutionHours), and
      // the officer dashboard reports the same figure for the same zone.
      const resolvedThisMonth = rows.filter(
        (c) =>
          c.resolvedAt &&
          new Date(c.resolvedAt).getMonth() === now.getMonth() &&
          new Date(c.resolvedAt).getFullYear() === now.getFullYear(),
      );
      const avgResolutionHoursForZone = avgResolutionHours(resolvedThisMonth);

      const severityHeat = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
      for (const c of rows.filter((c) => !TERMINAL_STATUSES.has(c.status))) {
        severityHeat[severityLabel(c.severityScore)]++;
      }

      // Same population and ordering as GET /leaderboard — active citizens
      // only, points desc then account age then id — otherwise this table
      // could crown a deactivated citizen the leaderboard doesn't even list.
      const topCitizens = db.users
        .filter((u) => u.role === "CITIZEN" && u.isActive && u.zoneId === zone.id)
        .map((u) => ({
          citizenId: u.id,
          displayName: u.displayName ?? `Citizen #${u.id}`,
          points: lifetimePoints(u.id),
          createdAt: u.createdAt,
        }))
        .sort(
          (a, b) =>
            b.points - a.points ||
            Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
            a.citizenId - b.citizenId,
        )
        .slice(0, 3)
        .map((entry, index) => ({
          rank: index + 1,
          citizenId: toApiId(entry.citizenId),
          displayName: entry.displayName,
          points: entry.points,
          isCurrentUser: false,
          isTopThree: true,
        }));

      return {
        zoneId: toApiId(zone.id),
        zoneName: zone.zoneName,
        pending: rows.filter((c) => !TERMINAL_STATUSES.has(c.status)).length,
        overdue,
        resolvedThisMonth: resolvedThisMonth.length,
        avgResolutionHours: avgResolutionHoursForZone,
        isHighestOverdue: false,
        topCitizens,
        severityHeat,
      };
    });

    const maxOverdue = Math.max(0, ...zoneStats.map((z) => z.overdue));
    for (const z of zoneStats)
      z.isHighestOverdue = maxOverdue > 0 && z.overdue === maxOverdue;

    return HttpResponse.json({ generatedAt: new Date().toISOString(), zones: zoneStats });
  }),

  http.get(`${BASE}/admin/officers/:officerId/performance`, ({ request, params }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;

    const officer = db.users.find(
      (u) => u.id === fromApiId(String(params.officerId)) && u.role === "OFFICER",
    );
    if (!officer) return Errors.notFound();

    const url = new URL(request.url);
    const period = url.searchParams.get("period") ?? "this_month";
    const dateFromParam = url.searchParams.get("dateFrom");
    const dateToParam = url.searchParams.get("dateTo");

    const now = new Date();
    let rangeStart: Date | null = null;
    let rangeEnd: Date | null = null;
    if (dateFromParam || dateToParam) {
      rangeStart = dateFromParam ? new Date(dateFromParam) : null;
      rangeEnd = dateToParam ? new Date(dateToParam) : null;
    } else if (period === "this_month") {
      rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === "last_month") {
      rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      rangeEnd = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const inRange = (iso: string) => {
      const d = new Date(iso);
      if (rangeStart && d < rangeStart) return false;
      if (rangeEnd && d >= rangeEnd) return false;
      return true;
    };

    const handled = db.complaints.filter(
      (c) => c.assignedOfficerId === officer.id && inRange(c.createdAt),
    );
    const unresolvableExcluded = handled.filter((c) => c.status === "UNRESOLVABLE");
    const scoredComplaints = handled.filter((c) => c.status !== "UNRESOLVABLE");

    let onTime = 0;
    let delayed = 0;
    let overdue = 0;
    for (const c of scoredComplaints) {
      const asOf = c.resolvedAt ? new Date(c.resolvedAt) : now;
      const label = slaLabel(
        c.slaTargetHours,
        c.slaStartedAt,
        c.slaPausedSeconds,
        c.slaPausedAt,
        asOf,
      );
      if (label === "ON_TIME") onTime++;
      else if (label === "DELAYED") delayed++;
      else if (label === "OVERDUE") overdue++;
    }

    const reviewedEvidence = db.evidence.filter(
      (e) => e.reviewedBy === officer.id && e.reviewedAt && inRange(e.reviewedAt),
    );
    const valid = reviewedEvidence.filter((e) => e.verdict === "VALID").length;
    const needsMoreEvidence = reviewedEvidence.filter(
      (e) => e.verdict === "NEEDS_MORE_EVIDENCE",
    ).length;
    const rejected = reviewedEvidence.filter((e) => e.verdict === "REJECTED").length;
    const acceptRejectRatio = valid + rejected > 0 ? valid / (valid + rejected) : null;

    // Attribution follows the `→ RESOLVED` transition, not assignedOfficerId,
    // so reassigning a complaint cannot retroactively move finished work
    // between scorecards. The *latest* such transition wins, so a complaint
    // that was disputed and re-resolved by someone else counts for whoever
    // actually re-fixed it — matching its latest resolvedAt. Cascade sweeps
    // carry a SYSTEM actor with no user attached and so land in nobody's
    // sample: one visit fixing one pothole is one resolution, however many
    // duplicates were filed about it.
    const resolvedByOfficer = db.complaints.filter((c) => {
      if (!c.resolvedAt || !inRange(c.resolvedAt)) return false;
      const latestResolution = db.statusHistory
        .filter((h) => h.complaintId === c.id && h.toStatus === "RESOLVED")
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
      return (
        latestResolution?.actorRole === "OFFICER" &&
        latestResolution.changedByUserId === officer.id
      );
    });
    const avgResolutionHoursForOfficer = avgResolutionHours(resolvedByOfficer);

    return HttpResponse.json({
      officerId: toApiId(officer.id),
      zoneId: officer.zoneId != null ? toApiId(officer.zoneId) : undefined,
      period,
      totalHandled: handled.length,
      onTime,
      delayed,
      overdue,
      unresolvableExcluded: unresolvableExcluded.length,
      evidenceBreakdown: { valid, needsMoreEvidence, rejected },
      acceptRejectRatio,
      avgResolutionHours: avgResolutionHoursForOfficer,
    });
  }),

  http.post(`${BASE}/admin/zones/:zoneId/ai-report`, ({ request, params }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;

    const zone = db.zones.find((z) => z.id === fromApiId(String(params.zoneId)));
    if (!zone) return Errors.notFound();

    const report = {
      id: nextId("aiZoneReports"),
      zoneId: zone.id,
      requestedBy: auth.user.id,
      status: "PENDING" as const,
      aiAvailable: true,
      summary: null,
      trends: null,
      hotspots: null,
      suggestions: null,
      generatedAt: null,
      createdAt: new Date().toISOString(),
    };
    db.aiZoneReports.push(report);
    persist();
    simulateAiZoneReportGeneration(report.id, zone.zoneName);

    return HttpResponse.json(
      {
        reportId: toApiId(report.id),
        zoneId: toApiId(zone.id),
        status: report.status,
        aiAvailable: report.aiAvailable,
        summary: report.summary,
        trends: report.trends,
        hotspots: report.hotspots,
        suggestions: report.suggestions,
        generatedAt: report.generatedAt,
      },
      { status: 202 },
    );
  }),

  http.get(`${BASE}/admin/zones/:zoneId/ai-report`, ({ request, params }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;

    const zoneId = fromApiId(String(params.zoneId));
    const latest = [...db.aiZoneReports]
      .filter((r) => r.zoneId === zoneId)
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];
    if (!latest)
      return Errors.notFound("No report has ever been generated for this zone.");

    return HttpResponse.json({
      reportId: toApiId(latest.id),
      zoneId: toApiId(latest.zoneId),
      status: latest.status,
      aiAvailable: latest.aiAvailable,
      summary: latest.summary,
      trends: latest.trends,
      hotspots: latest.hotspots,
      suggestions: latest.suggestions,
      generatedAt: latest.generatedAt,
    });
  }),

  http.get(`${BASE}/admin/export/complaints`, ({ request }) => {
    const auth = requireRole(request, "ADMIN");
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const zoneId = url.searchParams.get("zoneId");
    const categoryId = url.searchParams.get("categoryId");
    const statusFilter = url.searchParams.getAll("status");
    const slaFilter = url.searchParams.get("slaLabel");
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");

    let rows = db.complaints;
    if (zoneId) rows = rows.filter((c) => c.zoneId === fromApiId(zoneId));
    if (categoryId) rows = rows.filter((c) => c.categoryId === fromApiId(categoryId));
    if (statusFilter.length > 0)
      rows = rows.filter((c) => statusFilter.includes(c.status));
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
    if (dateFrom) rows = rows.filter((c) => new Date(c.createdAt) >= new Date(dateFrom));
    if (dateTo) rows = rows.filter((c) => new Date(c.createdAt) <= new Date(dateTo));

    const csv = toCsv(
      [
        "id",
        "category",
        "zone",
        "status",
        "severity",
        "createdAt",
        "updatedAt",
        "resolvedAt",
        "closedAt",
        "slaLabel",
        "officerId",
      ],
      rows.map((c) => [
        c.complaintCode,
        db.categories.find((cat) => cat.id === c.categoryId)?.categoryName ?? "",
        db.zones.find((z) => z.id === c.zoneId)?.zoneName ?? "",
        c.status,
        severityLabel(c.severityScore),
        c.createdAt,
        c.updatedAt,
        c.resolvedAt,
        c.closedAt,
        slaLabel(c.slaTargetHours, c.slaStartedAt, c.slaPausedSeconds, c.slaPausedAt) ??
          "",
        c.assignedOfficerId != null ? String(c.assignedOfficerId) : "",
      ]),
    );

    return new HttpResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="complaints.csv"',
      },
    });
  }),
];
