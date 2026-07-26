// @vitest-environment node
// See lifecycle.test.ts for why this runs in the node environment.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { server } from "../server";
import { resetDatabase } from "../db/store";
import { login, authedFetch } from "../test-utils";

const ZONE_WARD_12 = "2"; // Ward 12 – North
const ADMIN = "admin@kartavya.gov";
const PASSWORD = "password123";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  resetDatabase();
});
afterAll(() => server.close());

interface Entry {
  rank: number;
  citizenId: string;
  points: number;
  isTopThree: boolean;
  isCurrentUser: boolean;
}
interface Board {
  currentUser: Entry | null;
  data: Entry[];
  pagination: { totalItems: number };
}

async function registerCitizen(name: string, email: string) {
  const res = await fetch("http://localhost/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password: PASSWORD, zoneId: ZONE_WARD_12 }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { token: string; user: { id: string } };
}

async function board(token: string, query = ""): Promise<Board> {
  const res = await authedFetch(token)(
    `/leaderboard?scope=city&period=all_time&pageSize=100${query}`,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Board;
}

async function setActive(userId: string, active: boolean) {
  const admin = await login(ADMIN, PASSWORD);
  const res = await authedFetch(admin.token)(`/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });
  expect(res.status).toBe(200);
}

describe("GET /leaderboard — who is on the board", () => {
  it("includes a brand-new citizen with zero points, at the bottom", async () => {
    const newcomer = await registerCitizen("Newcomer", "newcomer@example.com");
    const result = await board(newcomer.token);

    const own = result.data.find((e) => e.citizenId === newcomer.user.id);
    expect(own).toBeDefined();
    expect(own!.points).toBe(0);

    // Bottom of the board: only citizens who have gone *negative* (rejection
    // penalties) may sit below a zero-point newcomer.
    for (const below of result.data.filter((e) => e.rank > own!.rank)) {
      expect(below.points).toBeLessThan(0);
    }
  });

  it("keeps a citizen with negative points on the board", async () => {
    const viewer = await registerCitizen("Viewer", "viewer@example.com");
    const result = await board(viewer.token);
    const negative = result.data.filter((e) => e.points < 0);

    expect(negative.length).toBeGreaterThan(0);
    // They rank last, but they are still ranked — not silently dropped.
    expect(negative.at(-1)!.rank).toBe(result.pagination.totalItems);
  });

  it("drops a deactivated citizen and moves everyone below them up", async () => {
    const viewer = await registerCitizen("Viewer", "viewer@example.com");
    const before = await board(viewer.token);

    // Deactivate whoever is currently top of the board.
    const leader = before.data[0];
    await setActive(leader.citizenId, false);

    const after = await board(viewer.token);
    expect(after.data.some((e) => e.citizenId === leader.citizenId)).toBe(false);
    expect(after.pagination.totalItems).toBe(before.pagination.totalItems - 1);

    // The old #2 is now #1 — nobody keeps a stale rank behind the gap.
    expect(after.data[0].citizenId).toBe(before.data[1].citizenId);
    expect(after.data[0].rank).toBe(1);
  });

  it("restores a reactivated citizen to their old standing, ledger intact", async () => {
    const viewer = await registerCitizen("Viewer", "viewer@example.com");
    const before = await board(viewer.token);
    const leader = before.data[0];

    await setActive(leader.citizenId, false);
    await setActive(leader.citizenId, true);

    const after = await board(viewer.token);
    const restored = after.data.find((e) => e.citizenId === leader.citizenId);
    expect(restored).toBeDefined();
    expect(restored!.rank).toBe(leader.rank);
    expect(restored!.points).toBe(leader.points);
  });

  it("never lists an officer or an admin", async () => {
    const viewer = await registerCitizen("Viewer", "viewer@example.com");
    const admin = await login(ADMIN, PASSWORD);
    const result = await board(viewer.token);

    expect(result.data.some((e) => e.citizenId === admin.user.id)).toBe(false);
  });
});

describe("GET /leaderboard — ordering and ranks", () => {
  it("assigns sequential ranks with no gaps or repeats, even on ties", async () => {
    // Several registrations in a row all sit on zero points, so ties are
    // guaranteed — they must still get consecutive ranks.
    await registerCitizen("Tie A", "tie-a@example.com");
    await registerCitizen("Tie B", "tie-b@example.com");
    const last = await registerCitizen("Tie C", "tie-c@example.com");

    const result = await board(last.token);
    const ranks = result.data.map((e) => e.rank);
    expect(ranks).toEqual(ranks.map((_, i) => i + 1));
  });

  it("makes isTopThree exactly `rank <= 3`", async () => {
    const viewer = await registerCitizen("Viewer", "viewer@example.com");
    const result = await board(viewer.token);

    for (const entry of result.data) {
      expect(entry.isTopThree).toBe(entry.rank <= 3);
    }
  });

  it("breaks a points tie by account age, oldest first", async () => {
    const first = await registerCitizen("Older", "older@example.com");
    const second = await registerCitizen("Newer", "newer@example.com");

    const result = await board(second.token);
    const olderRank = result.data.find((e) => e.citizenId === first.user.id)!.rank;
    const newerRank = result.data.find((e) => e.citizenId === second.user.id)!.rank;
    expect(olderRank).toBeLessThan(newerRank);
  });

  it("returns the same order for the same request twice", async () => {
    const viewer = await registerCitizen("Viewer", "viewer@example.com");
    const first = await board(viewer.token);
    const second = await board(viewer.token);
    expect(second.data.map((e) => e.citizenId)).toEqual(
      first.data.map((e) => e.citizenId),
    );
  });
});

describe("GET /leaderboard — currentUser", () => {
  it("is computed against the full ranking, not the requested page", async () => {
    const newcomer = await registerCitizen("Newcomer", "newcomer@example.com");

    const full = await board(newcomer.token);
    const own = full.data.find((e) => e.citizenId === newcomer.user.id)!;

    // Page 1 at size 1 cannot contain a near-last citizen...
    const res = await authedFetch(newcomer.token)(
      "/leaderboard?scope=city&period=all_time&page=1&pageSize=1",
    );
    expect(res.status).toBe(200);
    const firstPage = (await res.json()) as Board;
    expect(firstPage.data.some((e) => e.citizenId === newcomer.user.id)).toBe(false);

    // ...but currentUser still reports their real rank.
    expect(firstPage.currentUser).not.toBeNull();
    expect(firstPage.currentUser!.citizenId).toBe(newcomer.user.id);
    expect(firstPage.currentUser!.rank).toBe(own.rank);
  });
});
