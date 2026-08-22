// @vitest-environment node
// See lifecycle.test.ts for why this runs in the node environment.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { server } from "../server";
import { resetDatabase } from "../db/store";
import { login, authedFetch } from "../test-utils";
import { OPEN_STATUSES } from "../../lib/lifecycle";

/**
 * The officer zone map (`/officer/map`) draws two lists, and neither of them
 * is filtered by the client for correctness: `/officer/complaints` and
 * `/clusters` are narrowed to the officer's own zone by the server
 * (`visible_complaints` / `visible_clusters`). The page filters on `zoneId`
 * again, but as a second lock — this suite is what holds the first one.
 *
 * The mock is the development default, so a permissive mock is a bug a client
 * can only find in production. Two such gaps have already shipped. These
 * assertions are cheap and they fail loudly if either endpoint ever starts
 * answering with another zone's work.
 */

const WARD_12 = "2";
const WARD_07 = "3";
const PASSWORD = "password123";
const OFFICER_WARD_12 = "officer.ward12@kartavya.gov";
const ADMIN = "admin@kartavya.gov";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  resetDatabase();
});
afterAll(() => server.close());

interface Row {
  id: string;
  zoneId: string;
  status?: string;
  latitude?: number | null;
  longitude?: number | null;
}
interface List {
  data: Row[];
  pagination: { totalItems: number };
}

/** Exactly the request the map's `useMapComplaints("officer")` makes. */
function mapComplaintQuery(): string {
  const status = OPEN_STATUSES.map((s) => `status=${s}`).join("&");
  return `/officer/complaints?page=1&pageSize=100&${status}`;
}

async function list(token: string, path: string): Promise<List> {
  const res = await authedFetch(token)(path);
  expect(res.status).toBe(200);
  return (await res.json()) as List;
}

describe("officer zone map data is confined to the officer's zone", () => {
  it("returns only the officer's own zone from /officer/complaints", async () => {
    const officer = await login(OFFICER_WARD_12, PASSWORD);
    const page = await list(officer.token, mapComplaintQuery());

    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data.every((c) => c.zoneId === WARD_12)).toBe(true);
  });

  it("returns only the officer's own zone from /clusters", async () => {
    const officer = await login(OFFICER_WARD_12, PASSWORD);
    const page = await list(officer.token, "/clusters?page=1&pageSize=100");

    expect(page.data.every((c) => c.zoneId === WARD_12)).toBe(true);
  });

  // The point of the previous two, stated as a difference: the admin map is
  // fed by the same shapes over a wider set, so "one zone" has to be the
  // server narrowing the officer's view, not the seed happening to hold one
  // zone's worth of data.
  it("is narrower than what an admin sees over the same fetch", async () => {
    const admin = await login(ADMIN, PASSWORD);
    const status = OPEN_STATUSES.map((s) => `status=${s}`).join("&");
    const all = await list(
      admin.token,
      `/admin/complaints?page=1&pageSize=100&${status}`,
    );

    const zones = new Set(all.data.map((c) => c.zoneId));
    expect(zones.size).toBeGreaterThan(1);
    expect(zones.has(WARD_12)).toBe(true);
    expect(zones.has(WARD_07)).toBe(true);
  });

  // The map filters open statuses on the request rather than on the rows, so
  // that its ceiling is spent on complaints worth drawing. A terminal
  // complaint has also *left* its cluster, so letting one through would draw
  // a closed ex-member as an independent pin.
  it("excludes terminal complaints, which have left their cluster", async () => {
    const officer = await login(OFFICER_WARD_12, PASSWORD);
    const page = await list(officer.token, mapComplaintQuery());

    for (const complaint of page.data) {
      expect(OPEN_STATUSES).toContain(complaint.status);
    }
  });
});
