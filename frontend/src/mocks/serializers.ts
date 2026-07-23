import { db } from "./db/store";
import { slaLabel } from "./lib/sla";
import { severityLabel, severityScore } from "./lib/severity";
import { toApiId } from "./lib/ids";
import { placeholderPhotoUrl } from "./lib/placeholder";
import type {
  UserRow,
  ZoneRow,
  CategoryRow,
  ComplaintRow,
  EvidenceRow,
  StatusHistoryRow,
  NoteRow,
  ClusterRow,
} from "./db/types";
import type {
  User,
  Category,
  Zone,
  Complaint,
  ComplaintDetail,
  Evidence,
  StatusHistoryEntry,
  ProgressNote,
  Cluster,
  ClusterDetail,
  Role,
} from "../types/api";

export function toUser(row: UserRow): User {
  return {
    id: toApiId(row.id),
    role: row.role as Role,
    name: row.fullName,
    email: row.email,
    displayName: row.displayName,
    zoneId: row.zoneId != null ? toApiId(row.zoneId) : null,
    active: row.isActive,
    createdAt: row.createdAt,
  };
}

export function toCategory(row: CategoryRow): Category {
  return {
    id: toApiId(row.id),
    name: row.categoryName,
    description: row.description ?? undefined,
    slaTargetHours: row.slaHours,
  };
}

export function toZone(row: ZoneRow): Zone {
  return {
    id: toApiId(row.id),
    code: row.zoneCode,
    name: row.zoneName,
    isCatchAll: row.isCatchAll,
    isActive: row.isActive,
  };
}

function citizenActionFor(
  status: ComplaintRow["status"],
): Complaint["citizenActionNeeded"] {
  if (status === "RESOLVED") return "CONFIRM_FIX";
  if (status === "NEEDS_MORE_EVIDENCE") return "PROVIDE_MORE_EVIDENCE";
  return null;
}

/**
 * Compact `Complaint` shape used in every list/queue. Structurally has no
 * citizen-identity field at all (that only exists on ComplaintDetail.reporter,
 * admin-only), so no role-based stripping is needed here.
 */
export function toComplaintCompact(
  row: ComplaintRow,
  opts: { forOwner?: boolean } = {},
): Complaint {
  const category = db.categories.find((c) => c.id === row.categoryId)!;
  const zone = db.zones.find((z) => z.id === row.zoneId)!;
  const upvoteCount = db.upvotes.filter((u) => u.complaintId === row.id).length;
  const firstEvidence = db.evidence.find(
    (e) => e.complaintId === row.id && e.sequence === 1,
  );

  return {
    id: toApiId(row.id),
    category: toCategory(category),
    status: row.status,
    severityLabel: severityLabel(row.severityScore),
    slaLabel:
      slaLabel(
        row.slaTargetHours,
        row.slaStartedAt,
        row.slaPausedSeconds,
        row.slaPausedAt,
      ) ?? undefined,
    upvoteCount,
    photoUrl: firstEvidence ? photoUrlFor(firstEvidence) : undefined,
    zoneId: toApiId(zone.id),
    zoneName: zone.zoneName,
    assignedOfficerId:
      row.assignedOfficerId != null ? toApiId(row.assignedOfficerId) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    citizenActionNeeded: opts.forOwner ? citizenActionFor(row.status) : null,
  };
}

export function photoUrlFor(evidenceRow: EvidenceRow): string {
  // Real uploads (see complaints handler) store an actual blob: object URL as
  // filePath; seeded fixture rows never had a real photo, so those get a
  // deterministic placeholder instead of a broken link.
  if (
    evidenceRow.filePath.startsWith("blob:") ||
    evidenceRow.filePath.startsWith("data:")
  ) {
    return evidenceRow.filePath;
  }
  const category = db.categories.find(
    (c) =>
      c.id === db.complaints.find((cm) => cm.id === evidenceRow.complaintId)?.categoryId,
  );
  return placeholderPhotoUrl(category?.categoryName ?? "Evidence", evidenceRow.id);
}

export function toEvidence(row: EvidenceRow): Evidence {
  return {
    id: toApiId(row.id),
    photoUrl: photoUrlFor(row),
    sequence: row.sequence,
    aiConfidenceNote: {
      aiAvailable: row.aiScreenStatus !== "UNAVAILABLE",
      matchesCategory: row.aiMatchesCategory,
      confidence: row.aiConfidence,
      note: row.aiNote,
    },
    verdict: row.verdict,
    verdictReason: row.verdictReason,
    reviewedByOfficerId: row.reviewedBy != null ? toApiId(row.reviewedBy) : null,
    reviewedAt: row.reviewedAt,
    submittedAt: row.createdAt,
  };
}

export function toStatusHistoryEntry(row: StatusHistoryRow): StatusHistoryEntry {
  return {
    id: toApiId(row.id),
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    changedByRole: row.actorRole,
    changedByOfficerId:
      row.actorRole === "OFFICER" && row.changedByUserId != null
        ? toApiId(row.changedByUserId)
        : null,
    reason: row.reason,
    remark: row.remark,
    timestamp: row.createdAt,
  };
}

export function toProgressNote(row: NoteRow): ProgressNote {
  return {
    id: toApiId(row.id),
    officerId: toApiId(row.officerId),
    text: row.noteText,
    createdAt: row.createdAt,
  };
}

/** viewerRole ADMIN sees the reporter's identity; every other role never does. */
export function toComplaintDetail(
  row: ComplaintRow,
  viewerRole: Role,
  viewerUserId?: number,
): ComplaintDetail {
  const compact = toComplaintCompact(row, { forOwner: row.citizenId === viewerUserId });
  const reporterRow = db.users.find((u) => u.id === row.citizenId);

  return {
    ...compact,
    description: row.description ?? undefined,
    latitude: row.latitude,
    longitude: row.longitude,
    severityScore: row.severityScore,
    slaTargetHours: row.slaTargetHours,
    clusterId: row.clusterId != null ? toApiId(row.clusterId) : null,
    reporter: viewerRole === "ADMIN" && reporterRow ? toUser(reporterRow) : null,
    evidence: db.evidence
      .filter((e) => e.complaintId === row.id)
      .sort((a, b) => a.sequence - b.sequence)
      .map(toEvidence),
    statusHistory: db.statusHistory
      .filter((h) => h.complaintId === row.id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map(toStatusHistoryEntry),
    progressNotes: db.notes
      .filter((n) => n.complaintId === row.id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map(toProgressNote),
  };
}

export function toCluster(row: ClusterRow): Cluster {
  const category = db.categories.find((c) => c.id === row.categoryId)!;
  const members = db.complaints.filter((c) => c.clusterId === row.id);
  const totalUpvotes = members.reduce(
    (sum, m) => sum + db.upvotes.filter((u) => u.complaintId === m.id).length,
    0,
  );
  const score = severityScore(row.uniqueReporterCount, totalUpvotes);
  const statusSummary: Record<string, number> = {};
  for (const member of members) {
    statusSummary[member.status] = (statusSummary[member.status] ?? 0) + 1;
  }

  return {
    id: toApiId(row.id),
    zoneId: toApiId(row.zoneId),
    category: toCategory(category),
    reportCount: row.reportCount,
    uniqueReporterCount: row.uniqueReporterCount,
    severityScore: score,
    severityLabel: severityLabel(score),
    statusSummary,
    centroidLat: row.centroidLat,
    centroidLng: row.centroidLng,
    createdAt: row.createdAt,
  };
}

export function toClusterDetail(row: ClusterRow): ClusterDetail {
  return {
    ...toCluster(row),
    complaints: db.complaints
      .filter((c) => c.clusterId === row.id)
      .map((c) => toComplaintCompact(c)),
  };
}
