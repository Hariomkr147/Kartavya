import { http, HttpResponse } from "msw";
import { db } from "../db/store";
import { requireRole, paginate, parsePagination, Errors } from "../lib/http";
import { lifetimePoints } from "../lib/points";
import { toApiId } from "../lib/ids";
import { LEADERBOARD_PERIODS, checkEnumParam } from "../lib/enums";

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
    // Contract 3.1.0: citizens and admins may read, officers may not. Admins
    // use `scope=city` for cross-zone gamification oversight. `scope=zone`
    // still only makes sense for a citizen (an admin has no zoneId), so that
    // combination just yields an empty pool below rather than a rejection.
    // Reading is not being ranked: an admin is never a row, so `currentUser`
    // comes back null for them.
    const auth = requireRole(request, "CITIZEN", "ADMIN");
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const scope = url.searchParams.get("scope");
    if (scope !== "zone" && scope !== "city") {
      return Errors.badRequest("scope must be 'zone' or 'city'.");
    }
    // `period` defaults to monthly, but a value that is present and wrong is a
    // 400 on the backend, not a silent fall back to the default.
    const badPeriod = checkEnumParam(url, "period", LEADERBOARD_PERIODS);
    if (badPeriod) return badPeriod;
    const period = url.searchParams.get("period") === "all_time" ? "all_time" : "monthly";
    const now = new Date();

    // Active citizens only. A deactivated citizen drops out entirely and
    // everyone below moves up, but their points_ledger rows are untouched, so
    // reactivating restores their standing. Zero-point citizens *do* appear,
    // at the bottom — a new citizen seeing themselves ranked last is the nudge
    // the feature exists for.
    const pool = db.users.filter(
      (u) =>
        u.role === "CITIZEN" &&
        u.isActive &&
        (scope === "city" || u.zoneId === auth.user.zoneId),
    );

    const pointsFor = (citizenId: number) =>
      period === "all_time"
        ? lifetimePoints(citizenId)
        : db.pointsLedger
            .filter((p) => p.citizenId === citizenId && isThisMonth(p.createdAt, now))
            .reduce((s, p) => s + p.pointsChange, 0);

    // Points desc, then account age (older first), then citizenId — a total
    // order, so the same request twice can never interleave rows differently
    // and a citizen's rank does not depend on which page it is read from.
    // Ranks are sequential and never shared, which is what makes isTopThree
    // exactly `rank <= 3`.
    const ranked = pool
      .map((u) => ({
        citizenId: u.id,
        displayName: u.displayName ?? `Citizen #${u.id}`,
        points: pointsFor(u.id),
        createdAt: u.createdAt,
      }))
      .sort(
        (a, b) =>
          b.points - a.points ||
          Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
          a.citizenId - b.citizenId,
      )
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
