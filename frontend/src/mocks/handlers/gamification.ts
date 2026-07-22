import { http, HttpResponse } from "msw";
import { db } from "../db/store";
import { requireRole, paginate, parsePagination, Errors } from "../lib/http";
import { lifetimePoints } from "../lib/points";
import { toApiId } from "../lib/ids";

const BASE = "/api/v1";

function isThisMonth(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

export const gamificationHandlers = [
  http.get(`${BASE}/gamification/points`, ({ request }) => {
    const auth = requireRole(request, "CITIZEN");
    if (!auth.ok) return auth.response;

    const now = new Date();
    const mine = db.pointsLedger
      .filter((p) => p.citizenId === auth.user.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const url = new URL(request.url);
    const { data, pagination } = paginate(mine, parsePagination(url));

    return HttpResponse.json({
      totalLifetimeCsp: lifetimePoints(auth.user.id),
      currentMonthCsp: mine
        .filter((p) => isThisMonth(p.createdAt, now))
        .reduce((s, p) => s + p.pointsChange, 0),
      ledger: data.map((p) => ({
        id: toApiId(p.id),
        amount: p.pointsChange,
        reason: p.reason,
        complaintId: p.complaintId != null ? toApiId(p.complaintId) : null,
        createdAt: p.createdAt,
      })),
      pagination,
    });
  }),

  http.get(`${BASE}/gamification/badges`, ({ request }) => {
    const auth = requireRole(request, "CITIZEN");
    if (!auth.ok) return auth.response;

    const earned = db.citizenBadges
      .filter((cb) => cb.citizenId === auth.user.id)
      .sort((a, b) => new Date(a.earnedAt).getTime() - new Date(b.earnedAt).getTime());

    return HttpResponse.json(
      earned.map((cb) => {
        const badge = db.badges.find((b) => b.id === cb.badgeId)!;
        return {
          code: badge.badgeCode,
          name: badge.badgeName,
          description: badge.description ?? undefined,
          earnedAt: cb.earnedAt,
        };
      }),
    );
  }),

  http.get(`${BASE}/leaderboard`, ({ request }) => {
    const auth = requireRole(request, "CITIZEN");
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const scope = url.searchParams.get("scope");
    if (scope !== "zone" && scope !== "city") {
      return Errors.badRequest("scope must be 'zone' or 'city'.");
    }
    const period = url.searchParams.get("period") === "all_time" ? "all_time" : "monthly";
    const now = new Date();

    const pool = db.users.filter(
      (u) => u.role === "CITIZEN" && (scope === "city" || u.zoneId === auth.user.zoneId),
    );

    const pointsFor = (citizenId: number) =>
      period === "all_time"
        ? lifetimePoints(citizenId)
        : db.pointsLedger
            .filter((p) => p.citizenId === citizenId && isThisMonth(p.createdAt, now))
            .reduce((s, p) => s + p.pointsChange, 0);

    const ranked = pool
      .map((u) => ({
        citizenId: u.id,
        displayName: u.displayName ?? `Citizen #${u.id}`,
        points: pointsFor(u.id),
      }))
      .sort((a, b) => b.points - a.points || a.citizenId - b.citizenId)
      .map((entry, index) => ({
        rank: index + 1,
        citizenId: toApiId(entry.citizenId),
        displayName: entry.displayName,
        points: entry.points,
        isCurrentUser: entry.citizenId === auth.user.id,
        isTopThree: index < 3,
      }));

    const { data, pagination } = paginate(ranked, parsePagination(url));
    const currentUser = ranked.find((r) => r.isCurrentUser) ?? null;

    return HttpResponse.json({
      scope,
      period,
      generatedAt: new Date().toISOString(),
      currentUser,
      data,
      pagination,
    });
  }),
];
