// @vitest-environment node
// Pure API-layer tests — Node's native fetch is what MSW's node interceptors
// patch most reliably (jsdom ships its own fetch implementation that some
// MSW interceptor versions don't see).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { server } from "../server";
import { resetDatabase } from "../db/store";
import { login, authedFetch, makePhoto } from "../test-utils";

const ZONE_WARD_12 = "2"; // Ward 12 – North
const OFFICER_WARD_12 = "officer.ward12@kartavya.gov";
const ADMIN = "admin@kartavya.gov";
const PASSWORD = "password123";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  resetDatabase();
});
afterAll(() => server.close());

async function registerCitizen(name: string, email: string, zoneId = ZONE_WARD_12) {
  const res = await fetch("http://localhost/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password: PASSWORD, zoneId }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { token: string; user: { id: string } };
}

async function fileComplaint(
  token: string,
  opts: {
    categoryId?: string;
    latitude?: number;
    longitude?: number;
    description?: string;
  } = {},
) {
  const form = new FormData();
  form.set("categoryId", opts.categoryId ?? "1"); // Pothole
  form.set("latitude", String(opts.latitude ?? 12.9716));
  form.set("longitude", String(opts.longitude ?? 77.5946));
  form.set("zoneId", ZONE_WARD_12);
  form.set("description", opts.description ?? "A deep pothole near the junction.");
  form.set("photo", makePhoto());

  const res = await authedFetch(token)("/complaints", { method: "POST", body: form });
  expect(res.status).toBe(201);
  return await res.json();
}

describe("standalone complaint: full happy path", () => {
  it("carries a complaint from SUBMITTED to CLOSED, crediting the right points and badges", async () => {
    const citizen = await registerCitizen("Test Citizen One", "citizen-one@example.com");
    const officer = await login(OFFICER_WARD_12, PASSWORD);
    const citizenApi = authedFetch(citizen.token);
    const officerApi = authedFetch(officer.token);

    const created = await fileComplaint(citizen.token);
    expect(created.status).toBe("SUBMITTED");
    const complaintId = created.id;

    // First complaint ever -> FIRST_COMPLAINT bonus + KARTAVYA_INITIATE badge.
    const pointsAfterFile = await citizenApi("/gamification/points").then((r) =>
      r.json(),
    );
    expect(pointsAfterFile.totalLifetimeCsp).toBe(10);
    const badgesAfterFile = await citizenApi("/gamification/badges").then((r) =>
      r.json(),
    );
    expect(
      badgesAfterFile.some((b: { code: string }) => b.code === "KARTAVYA_INITIATE"),
    ).toBe(true);

    // Officer claims it.
    const claimed = await officerApi(`/officer/complaints/${complaintId}/claim`, {
      method: "POST",
    }).then((r) => r.json());
    expect(claimed.status).toBe("EVIDENCE_UNDER_REVIEW");

    // Officer accepts the evidence -> SLA clock starts.
    const accepted = await officerApi(
      `/officer/complaints/${complaintId}/evidence-review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict: "VALID" }),
      },
    ).then((r) => r.json());
    expect(accepted.status).toBe("UNDER_REVIEW");
    expect(accepted.slaTargetHours).toBe(72); // Pothole SLA
    expect(accepted.slaLabel).toBe("ON_TIME");

    // Officer walks it through the rest of the lifecycle.
    for (const status of ["IN_PROGRESS", "UNDER_RESOLUTION", "RESOLVED"] as const) {
      const res = await officerApi(`/officer/complaints/${complaintId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.complaint.status).toBe(status);
    }

    // Citizen confirms -> CLOSED, full reward + on-time bonus.
    const confirmed = await citizenApi(`/complaints/${complaintId}/confirm`, {
      method: "POST",
    }).then((r) => r.json());
    expect(confirmed.status).toBe("CLOSED");

    const finalPoints = await citizenApi("/gamification/points").then((r) => r.json());
    // FIRST_COMPLAINT(10) + COMPLAINT_CLOSED(50) + ON_TIME_BONUS(15)
    expect(finalPoints.totalLifetimeCsp).toBe(75);
  });

  it("rejects a complaint on its first evidence round and penalises the citizen", async () => {
    const citizen = await registerCitizen("Test Citizen Two", "citizen-two@example.com");
    const officer = await login(OFFICER_WARD_12, PASSWORD);
    const created = await fileComplaint(citizen.token);

    await authedFetch(officer.token)(`/officer/complaints/${created.id}/claim`, {
      method: "POST",
    });
    const rejected = await authedFetch(officer.token)(
      `/officer/complaints/${created.id}/evidence-review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict: "REJECTED", reason: "Not a real pothole." }),
      },
    ).then((r) => r.json());
    expect(rejected.status).toBe("REJECTED");

    const points = await authedFetch(citizen.token)("/gamification/points").then((r) =>
      r.json(),
    );
    // FIRST_COMPLAINT(+10) then REJECTED_PENALTY(-20).
    expect(points.totalLifetimeCsp).toBe(-10);
  });

  it("cannot be rejected on a second evidence round after an officer's post-acceptance recall", async () => {
    const citizen = await registerCitizen(
      "Test Citizen Three",
      "citizen-three@example.com",
    );
    const officer = await login(OFFICER_WARD_12, PASSWORD);
    const created = await fileComplaint(citizen.token);
    const officerApi = authedFetch(officer.token);

    await officerApi(`/officer/complaints/${created.id}/claim`, { method: "POST" });
    await officerApi(`/officer/complaints/${created.id}/evidence-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: "VALID" }),
    });
    // Officer recalls for better evidence — pauses the SLA clock.
    const recalled = await officerApi(`/officer/complaints/${created.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "NEEDS_MORE_EVIDENCE",
        reason: "Need a clearer angle.",
      }),
    }).then((r) => r.json());
    expect(recalled.complaint.status).toBe("NEEDS_MORE_EVIDENCE");

    // Citizen resubmits.
    const form = new FormData();
    form.set("photo", makePhoto("resubmit.jpg"));
    const resubmitted = await authedFetch(citizen.token)(
      `/complaints/${created.id}/evidence`,
      {
        method: "POST",
        body: form,
      },
    ).then((r) => r.json());
    expect(resubmitted.status).toBe("EVIDENCE_UNDER_REVIEW");

    // REJECTED is no longer offered on this second round.
    const rejectAttempt = await officerApi(
      `/officer/complaints/${created.id}/evidence-review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict: "REJECTED", reason: "trying anyway" }),
      },
    );
    expect(rejectAttempt.status).toBe(409);

    // But VALID still resumes it normally.
    const resumed = await officerApi(
      `/officer/complaints/${created.id}/evidence-review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict: "VALID" }),
      },
    ).then((r) => r.json());
    expect(resumed.status).toBe("UNDER_REVIEW");
  });
});

describe("cluster formation, cascade, and reward split", () => {
  it("links nearby same-category complaints and cascades resolution while splitting the reward", async () => {
    const citizenA = await registerCitizen("Cluster Citizen A", "cluster-a@example.com");
    const citizenB = await registerCitizen("Cluster Citizen B", "cluster-b@example.com");
    const officer = await login(OFFICER_WARD_12, PASSWORD);
    const officerApi = authedFetch(officer.token);

    // Deliberately far from the seeded Ward-12 pothole cluster (which sits
    // right at the zone centre) so this test forms its own, isolated cluster.
    const complaintA = await fileComplaint(citizenA.token, {
      latitude: 13.5,
      longitude: 78.5,
    });
    const complaintB = await fileComplaint(citizenB.token, {
      latitude: 13.50005,
      longitude: 78.50005,
    }); // ~7m away

    expect(complaintA.clusterId).toBeNull(); // standalone until a match arrives
    expect(complaintB.clusterId).not.toBeNull(); // B's filing is what forms the cluster

    // Re-fetch A — it should now be linked to the same cluster B joined.
    const refetchedA = await officerApi(`/complaints/${complaintA.id}`).then((r) =>
      r.json(),
    );
    expect(refetchedA.clusterId).toBe(complaintB.clusterId);

    // Move both through to a cascade-eligible state.
    for (const id of [complaintA.id, complaintB.id]) {
      await officerApi(`/officer/complaints/${id}/claim`, { method: "POST" });
      await officerApi(`/officer/complaints/${id}/evidence-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict: "VALID" }),
      });
      await officerApi(`/officer/complaints/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
    }
    // Only push A to UNDER_RESOLUTION — B stays at UNDER_REVIEW-eligible IN_PROGRESS,
    // which is still cascade-eligible per CLUSTERED_COMPLAINT_LIFECYCLE.MD.
    await officerApi(`/officer/complaints/${complaintA.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "UNDER_RESOLUTION" }),
    });

    const resolveResult = await officerApi(
      `/officer/complaints/${complaintA.id}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "RESOLVED" }),
      },
    ).then((r) => r.json());

    expect(resolveResult.complaint.status).toBe("RESOLVED");
    expect(resolveResult.cascade).toBeDefined();
    const bOutcome = resolveResult.cascade.find(
      (c: { complaintId: string }) => c.complaintId === complaintB.id,
    );
    expect(bOutcome.outcome).toBe("CASCADED");

    const refetchedB = await officerApi(`/complaints/${complaintB.id}`).then((r) =>
      r.json(),
    );
    expect(refetchedB.status).toBe("RESOLVED");

    // B's citizen confirms FIRST -> gets the full +50.
    await authedFetch(citizenB.token)(`/complaints/${complaintB.id}/confirm`, {
      method: "POST",
    });
    const pointsB = await authedFetch(citizenB.token)("/gamification/points").then((r) =>
      r.json(),
    );
    expect(
      pointsB.ledger.some((p: { reason: string }) => p.reason === "COMPLAINT_CLOSED"),
    ).toBe(true);

    // A's citizen confirms second -> only the +10 consolation.
    await authedFetch(citizenA.token)(`/complaints/${complaintA.id}/confirm`, {
      method: "POST",
    });
    const pointsA = await authedFetch(citizenA.token)("/gamification/points").then((r) =>
      r.json(),
    );
    expect(
      pointsA.ledger.some(
        (p: { reason: string }) => p.reason === "CLUSTER_MEMBER_CLOSED",
      ),
    ).toBe(true);
    expect(
      pointsA.ledger.some((p: { reason: string }) => p.reason === "COMPLAINT_CLOSED"),
    ).toBe(false);
  });
});

describe("dispute and admin dispute-review", () => {
  async function resolveFreshComplaint(citizenToken: string, officerToken: string) {
    const created = await fileComplaint(citizenToken);
    const officerApi = authedFetch(officerToken);
    await officerApi(`/officer/complaints/${created.id}/claim`, { method: "POST" });
    await officerApi(`/officer/complaints/${created.id}/evidence-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: "VALID" }),
    });
    for (const status of ["IN_PROGRESS", "UNDER_RESOLUTION", "RESOLVED"] as const) {
      await officerApi(`/officer/complaints/${created.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    }
    return created.id as string;
  }

  it("upheld: sends the complaint back to IN_PROGRESS via the officer's zone", async () => {
    const citizen = await registerCitizen(
      "Dispute Citizen One",
      "dispute-one@example.com",
    );
    const officer = await login(OFFICER_WARD_12, PASSWORD);
    const admin = await login(ADMIN, PASSWORD);
    const complaintId = await resolveFreshComplaint(citizen.token, officer.token);

    const form = new FormData();
    form.set("reason", "The pothole is still there.");
    form.set("photo", makePhoto("dispute.jpg"));
    const disputed = await authedFetch(citizen.token)(
      `/complaints/${complaintId}/dispute`,
      {
        method: "POST",
        body: form,
      },
    ).then((r) => r.json());
    expect(disputed.status).toBe("REOPENED");

    // An officer can no longer touch it directly.
    const officerAttempt = await authedFetch(officer.token)(
      `/officer/complaints/${complaintId}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      },
    );
    expect(officerAttempt.status).toBe(409);

    const verdict = await authedFetch(admin.token)(
      `/admin/complaints/${complaintId}/dispute-review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verdict: "UPHELD",
          reason: "Photo confirms it reopened.",
        }),
      },
    ).then((r) => r.json());
    expect(verdict.status).toBe("IN_PROGRESS");
  });

  it("rejected: closes the complaint with no points, same as an auto-close", async () => {
    const citizen = await registerCitizen(
      "Dispute Citizen Two",
      "dispute-two@example.com",
    );
    const officer = await login(OFFICER_WARD_12, PASSWORD);
    const admin = await login(ADMIN, PASSWORD);
    const complaintId = await resolveFreshComplaint(citizen.token, officer.token);

    const form = new FormData();
    form.set("reason", "Still broken.");
    form.set("photo", makePhoto("dispute2.jpg"));
    await authedFetch(citizen.token)(`/complaints/${complaintId}/dispute`, {
      method: "POST",
      body: form,
    });

    const pointsBeforeVerdict = await authedFetch(citizen.token)(
      "/gamification/points",
    ).then((r) => r.json());

    const verdict = await authedFetch(admin.token)(
      `/admin/complaints/${complaintId}/dispute-review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verdict: "REJECTED",
          reason: "Fix looks intact in the photo.",
        }),
      },
    ).then((r) => r.json());
    expect(verdict.status).toBe("CLOSED");

    const pointsAfterVerdict = await authedFetch(citizen.token)(
      "/gamification/points",
    ).then((r) => r.json());
    expect(pointsAfterVerdict.totalLifetimeCsp).toBe(
      pointsBeforeVerdict.totalLifetimeCsp,
    );
  });
});

describe("officer batch-status", () => {
  it("reports mixed per-item success/failure and never cascades", async () => {
    const citizen = await registerCitizen("Batch Citizen", "batch-citizen@example.com");
    const officer = await login(OFFICER_WARD_12, PASSWORD);
    const officerApi = authedFetch(officer.token);

    const created = await fileComplaint(citizen.token);
    await officerApi(`/officer/complaints/${created.id}/claim`, { method: "POST" });
    await officerApi(`/officer/complaints/${created.id}/evidence-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: "VALID" }),
    });

    const batchResult = await officerApi("/officer/complaints/batch-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        complaintIds: [created.id, "999999"],
        status: "IN_PROGRESS",
      }),
    }).then((r) => r.json());

    expect(batchResult.summary).toEqual({ requested: 2, succeeded: 1, failed: 1 });
    const ok = batchResult.results.find(
      (r: { complaintId: string }) => r.complaintId === created.id,
    );
    expect(ok.success).toBe(true);
    expect(ok.status).toBe("IN_PROGRESS");
    const unknown = batchResult.results.find(
      (r: { complaintId: string }) => r.complaintId === "999999",
    );
    expect(unknown.success).toBe(false);
    expect(unknown.errorCode).toBe("UNKNOWN_COMPLAINT");
  });
});
