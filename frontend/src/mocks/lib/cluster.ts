import { db, nextId } from "../db/store";
import { haversineMeters } from "./geo";
import { severityScore } from "./severity";
import { toApiId } from "./ids";
import type { ComplaintRow } from "../db/types";

/** Nearby same-category duplicates are linked within this radius (schema.dbml: ~50-100m). */
const CLUSTER_RADIUS_METERS = 100;

function ownUpvoteCount(complaintId: number): number {
  return db.upvotes.filter((u) => u.complaintId === complaintId).length;
}

/** Recomputes complaints.severityScore for one complaint from its cluster (if any) + its own upvotes. */
export function recomputeSeverity(complaint: ComplaintRow): void {
  const uniqueReporterCount = complaint.clusterId
    ? (db.clusters.find((c) => c.id === complaint.clusterId)?.uniqueReporterCount ?? 1)
    : 1;
  complaint.severityScore = severityScore(
    uniqueReporterCount,
    ownUpvoteCount(complaint.id),
  );
}

function recomputeClusterCentroid(clusterId: number): void {
  const cluster = db.clusters.find((c) => c.id === clusterId);
  if (!cluster) return;
  const members = db.complaints.filter((c) => c.clusterId === clusterId);
  // A cluster left with no members (its last one just moved out) keeps its
  // row — clusters are never deleted here — but recomputing an average over
  // zero members would poison centroid/lat/lng with NaN, so leave it as-is.
  if (members.length === 0) {
    cluster.reportCount = 0;
    cluster.uniqueReporterCount = 0;
    cluster.updatedAt = new Date().toISOString();
    return;
  }
  cluster.centroidLat = members.reduce((sum, m) => sum + m.latitude, 0) / members.length;
  cluster.centroidLng = members.reduce((sum, m) => sum + m.longitude, 0) / members.length;
  cluster.reportCount = members.length;
  cluster.uniqueReporterCount = new Set(members.map((m) => m.citizenId)).size;
  cluster.updatedAt = new Date().toISOString();
  for (const member of members) recomputeSeverity(member);
}

/**
 * Detaches a complaint from its current cluster (if any) and re-links it
 * under its (possibly just-changed) category/zone. Clusters are strictly
 * same-category/same-zone (CLUSTERED_COMPLAINT_LIFECYCLE.MD), so an admin
 * override that edits `categoryId`/`zoneId` on a clustered complaint must
 * route through this rather than mutating those fields in place — otherwise
 * the complaint's own category/zone would permanently diverge from the
 * cluster it's still sitting in.
 */
export function reassignComplaintCluster(complaint: ComplaintRow): void {
  const previousClusterId = complaint.clusterId;
  if (previousClusterId != null) {
    complaint.clusterId = null;
    recomputeClusterCentroid(previousClusterId);
  }
  linkComplaintToCluster(complaint);
}

/**
 * Links a newly-created complaint into a nearby same-category, same-zone
 * cluster (joining an existing one, or forming a new one with the nearest
 * matching standalone complaint), or leaves it standalone if nothing nearby
 * matches. Recomputes severity for every affected complaint afterwards.
 * Matches CLUSTERED_COMPLAINT_LIFECYCLE.MD: distance + category + zone based,
 * no ML. A REJECTED complaint is excluded as a match seed — a debunked fake
 * report shouldn't anchor a new cluster.
 */
export function linkComplaintToCluster(complaint: ComplaintRow): void {
  const candidateClusters = db.clusters.filter(
    (c) => c.categoryId === complaint.categoryId && c.zoneId === complaint.zoneId,
  );
  const nearestCluster = candidateClusters
    .map((c) => ({
      cluster: c,
      distance: haversineMeters(
        complaint.latitude,
        complaint.longitude,
        c.centroidLat,
        c.centroidLng,
      ),
    }))
    .filter((c) => c.distance <= CLUSTER_RADIUS_METERS)
    .sort((a, b) => a.distance - b.distance)[0];

  if (nearestCluster) {
    complaint.clusterId = nearestCluster.cluster.id;
    recomputeClusterCentroid(nearestCluster.cluster.id);
    for (const member of db.complaints.filter(
      (c) => c.clusterId === nearestCluster.cluster.id,
    )) {
      recomputeSeverity(member);
    }
    return;
  }

  const candidateStandalone = db.complaints
    .filter(
      (c) =>
        c.id !== complaint.id &&
        c.clusterId == null &&
        c.categoryId === complaint.categoryId &&
        c.zoneId === complaint.zoneId &&
        c.status !== "REJECTED",
    )
    .map((c) => ({
      complaint: c,
      distance: haversineMeters(
        complaint.latitude,
        complaint.longitude,
        c.latitude,
        c.longitude,
      ),
    }))
    .filter((c) => c.distance <= CLUSTER_RADIUS_METERS)
    .sort((a, b) => a.distance - b.distance)[0];

  if (candidateStandalone) {
    const now = new Date().toISOString();
    const cluster = {
      id: nextId("clusters"),
      categoryId: complaint.categoryId,
      zoneId: complaint.zoneId,
      centroidLat: (complaint.latitude + candidateStandalone.complaint.latitude) / 2,
      centroidLng: (complaint.longitude + candidateStandalone.complaint.longitude) / 2,
      reportCount: 2,
      uniqueReporterCount: new Set([
        complaint.citizenId,
        candidateStandalone.complaint.citizenId,
      ]).size,
      rewardGranted: false,
      createdAt: now,
      updatedAt: now,
    };
    db.clusters.push(cluster);
    complaint.clusterId = cluster.id;
    candidateStandalone.complaint.clusterId = cluster.id;
    recomputeSeverity(complaint);
    recomputeSeverity(candidateStandalone.complaint);
    return;
  }

  // No match — stays standalone.
  recomputeSeverity(complaint);
}

/** Recomputes severity for every complaint sharing `complaintId`'s cluster (or just itself if standalone). */
export function recomputeSeverityForClusterOf(complaintId: number): void {
  const complaint = db.complaints.find((c) => c.id === complaintId);
  if (!complaint) return;
  if (complaint.clusterId == null) {
    recomputeSeverity(complaint);
    return;
  }
  for (const member of db.complaints.filter((c) => c.clusterId === complaint.clusterId)) {
    recomputeSeverity(member);
  }
}

export interface CascadeOutcome {
  complaintId: string;
  outcome: "CASCADED" | "SKIPPED";
  previousStatus: ComplaintRow["status"];
}

/**
 * Cascades every OTHER member of `resolvedComplaint`'s cluster to RESOLVED,
 * skipping anything not eligible. Per CLUSTERED_COMPLAINT_LIFECYCLE.MD §4:
 * only UNDER_REVIEW / IN_PROGRESS / UNDER_RESOLUTION members cascade; the
 * evidence phase and a pending REOPENED dispute are never bypassed.
 */
export function cascadeClusterResolution(
  resolvedComplaint: ComplaintRow,
): CascadeOutcome[] {
  if (resolvedComplaint.clusterId == null) return [];
  const cascadeEligible: ComplaintRow["status"][] = [
    "UNDER_REVIEW",
    "IN_PROGRESS",
    "UNDER_RESOLUTION",
  ];
  const now = new Date().toISOString();
  const results: CascadeOutcome[] = [];

  for (const member of db.complaints.filter(
    (c) => c.clusterId === resolvedComplaint.clusterId && c.id !== resolvedComplaint.id,
  )) {
    const previousStatus = member.status;
    if (cascadeEligible.includes(member.status)) {
      member.status = "RESOLVED";
      member.resolvedAt = now;
      member.updatedAt = now;
      db.statusHistory.push({
        id: nextId("statusHistory"),
        complaintId: member.id,
        fromStatus: previousStatus,
        toStatus: "RESOLVED",
        actorRole: "SYSTEM",
        changedByUserId: null,
        reason: null,
        remark: "Resolved automatically — another member of this cluster was resolved.",
        createdAt: now,
      });
      results.push({
        complaintId: toApiId(member.id),
        outcome: "CASCADED",
        previousStatus,
      });
    } else {
      results.push({
        complaintId: toApiId(member.id),
        outcome: "SKIPPED",
        previousStatus,
      });
    }
  }
  return results;
}
