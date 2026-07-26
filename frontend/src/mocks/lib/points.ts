import { db, nextId } from "../db/store";
import type { PointsReason } from "../db/types";

export const POINTS_AMOUNTS: Record<PointsReason, number> = {
  COMPLAINT_CLOSED: 50,
  CLUSTER_MEMBER_CLOSED: 10,
  FIRST_COMPLAINT: 10,
  ON_TIME_BONUS: 15,
  UPVOTE_RECEIVED: 5,
  REJECTED_PENALTY: -20,
};

export function awardPoints(
  citizenId: number,
  complaintId: number | null,
  reason: PointsReason,
): void {
  db.pointsLedger.push({
    id: nextId("pointsLedger"),
    citizenId,
    complaintId,
    pointsChange: POINTS_AMOUNTS[reason],
    reason,
    createdAt: new Date().toISOString(),
  });
  checkAndAwardBadges(citizenId);
}

export function lifetimePoints(citizenId: number): number {
  return db.pointsLedger
    .filter((p) => p.citizenId === citizenId)
    .reduce((sum, p) => sum + p.pointsChange, 0);
}

export function closedComplaintCount(citizenId: number): number {
  return db.complaints.filter((c) => c.citizenId === citizenId && c.status === "CLOSED")
    .length;
}

/** True if this citizen currently ranks #1 by lifetime CSP within their own zone. */
function isZoneRankOne(citizenId: number): boolean {
  const citizen = db.users.find((u) => u.id === citizenId);
  if (!citizen || citizen.role !== "CITIZEN" || citizen.zoneId == null) return false;
  const zonePeers = db.users.filter(
    (u) => u.role === "CITIZEN" && u.zoneId === citizen.zoneId,
  );
  const ranked = zonePeers
    .map((u) => ({ id: u.id, points: lifetimePoints(u.id) }))
    .sort((a, b) => b.points - a.points || a.id - b.id);
  return ranked.length > 0 && ranked[0].id === citizenId;
}

/** At least `count` of this citizen's complaints have closedAt within any `days`-day window. */
function hasClosedWithinDays(citizenId: number, days: number, count: number): boolean {
  const closedTimestamps = db.complaints
    .filter((c) => c.citizenId === citizenId && c.closedAt)
    .map((c) => new Date(c.closedAt!).getTime())
    .sort((a, b) => a - b);
  const windowMs = days * 24 * 3600 * 1000;
  for (let i = 0; i + count - 1 < closedTimestamps.length; i++) {
    if (closedTimestamps[i + count - 1] - closedTimestamps[i] <= windowMs) return true;
  }
  return false;
}

/** Data-driven badge engine — evaluates every not-yet-earned badge's criteria. */
export function checkAndAwardBadges(citizenId: number): void {
  const citizen = db.users.find((u) => u.id === citizenId);
  if (!citizen || citizen.role !== "CITIZEN") return;

  const alreadyEarned = new Set(
    db.citizenBadges.filter((b) => b.citizenId === citizenId).map((b) => b.badgeId),
  );

  for (const badge of db.badges) {
    if (alreadyEarned.has(badge.id)) continue;

    let earned = false;
    switch (badge.criteriaType) {
      case "FIRST_COMPLAINT":
        earned = db.complaints.some((c) => c.citizenId === citizenId);
        break;
      case "COMPLAINTS_CLOSED":
        earned = closedComplaintCount(citizenId) >= (badge.criteriaValue ?? Infinity);
        break;
      case "LIFETIME_POINTS":
        earned = lifetimePoints(citizenId) >= (badge.criteriaValue ?? Infinity);
        break;
      case "ZONE_RANK_ONE":
        earned = isZoneRankOne(citizenId);
        break;
      case "CLOSED_WITHIN_DAYS":
        earned = hasClosedWithinDays(
          citizenId,
          badge.criteriaValue ?? Infinity,
          badge.criteriaCount ?? Infinity,
        );
        break;
    }

    if (earned) {
      db.citizenBadges.push({
        id: nextId("citizenBadges"),
        citizenId,
        badgeId: badge.id,
        earnedAt: new Date().toISOString(),
      });
    }
  }
}

/** Fires right after a complaint is created — FIRST_COMPLAINT is filing-triggered, not points-triggered. */
export function checkFirstComplaintBadge(citizenId: number): void {
  checkAndAwardBadges(citizenId);
}
