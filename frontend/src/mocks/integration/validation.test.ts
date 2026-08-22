// @vitest-environment node
/**
 * The mock must refuse what the backend refuses.
 *
 * Every handler parses its body with `(await request.json()) as SomeRequest` —
 * a cast that erases at runtime. The real backend validates each of these with
 * a Pydantic enum and answers 400, so any gap here is a bug a client can only
 * discover in production, and `VITE_USE_MOCKS` defaults to true.
 *
 * The evidence-review case is the one that already bit: an unrecognised
 * verdict fell through to the final `else` and drove the complaint to terminal
 * REJECTED, with a 200 in reply.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { server } from "../server";
import { resetDatabase } from "../db/store";
import { login, authedFetch, makePhoto } from "../test-utils";

const ZONE_WARD_12 = "2";
const OFFICER = "officer.ward12@kartavya.gov";
const ADMIN = "admin@kartavya.gov";
const CITIZEN = "aditi@example.com";
const PASSWORD = "password123";
const JSON_HEADERS = { "Content-Type": "application/json" };

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  resetDatabase();
});
afterAll(() => server.close());

async function fileComplaint(token: string) {
  const form = new FormData();
  form.set("categoryId", "1");
  form.set("latitude", "12.9716");
  form.set("longitude", "77.5946");
  form.set("zoneId", ZONE_WARD_12);
  form.set("description", "A deep pothole near the junction.");
  form.append("photos", makePhoto());
  const res = await authedFetch(token)("/complaints", { method: "POST", body: form });
  return (await res.json()) as { id: string };
}

describe("request enums are validated, not cast", () => {
  it("refuses an unknown evidence verdict without touching the complaint", async () => {
    const citizen = await login(CITIZEN, PASSWORD);
    const officer = await login(OFFICER, PASSWORD);
    const complaint = await fileComplaint(citizen.token);
    const officerApi = authedFetch(officer.token);
    await officerApi(`/officer/complaints/${complaint.id}/claim`, { method: "POST" });

    const res = await officerApi(`/officer/complaints/${complaint.id}/evidence-review`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ verdict: "INSUFFICIENT", reason: "too dark" }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");

    // The complaint must be exactly where it was — not driven to REJECTED.
    const after = await authedFetch(citizen.token)(`/complaints/${complaint.id}`);
    const detail = await after.json();
    expect(detail.status).toBe("EVIDENCE_UNDER_REVIEW");
    expect(detail.evidence[0].verdict).toBeNull();
  });

  it("still accepts every verdict the contract lists", async () => {
    const citizen = await login(CITIZEN, PASSWORD);
    const officer = await login(OFFICER, PASSWORD);
    const complaint = await fileComplaint(citizen.token);
    const officerApi = authedFetch(officer.token);
    await officerApi(`/officer/complaints/${complaint.id}/claim`, { method: "POST" });

    const res = await officerApi(`/officer/complaints/${complaint.id}/evidence-review`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ verdict: "VALID" }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("UNDER_REVIEW");
  });

  it("refuses an unknown dispute verdict without closing the complaint", async () => {
    const citizen = await login(CITIZEN, PASSWORD);
    const officer = await login(OFFICER, PASSWORD);
    const admin = await login(ADMIN, PASSWORD);
    const citizenApi = authedFetch(citizen.token);
    const officerApi = authedFetch(officer.token);
    const complaint = await fileComplaint(citizen.token);

    await officerApi(`/officer/complaints/${complaint.id}/claim`, { method: "POST" });
    await officerApi(`/officer/complaints/${complaint.id}/evidence-review`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ verdict: "VALID" }),
    });
    for (const status of ["IN_PROGRESS", "UNDER_RESOLUTION", "RESOLVED"]) {
      await officerApi(`/officer/complaints/${complaint.id}/status`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ status, note: "progressing on site" }),
      });
    }
    const disputeForm = new FormData();
    disputeForm.set("reason", "Still not fixed.");
    disputeForm.append("photo", makePhoto());
    await citizenApi(`/complaints/${complaint.id}/dispute`, {
      method: "POST",
      body: disputeForm,
    });

    const res = await authedFetch(admin.token)(
      `/admin/complaints/${complaint.id}/dispute-review`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ verdict: "MAYBE", reason: "unsure" }),
      },
    );

    expect(res.status).toBe(400);
    const after = await citizenApi(`/complaints/${complaint.id}`);
    expect((await after.json()).status).toBe("REOPENED");
  });

  it("refuses a role the API cannot mint", async () => {
    const admin = await login(ADMIN, PASSWORD);

    const res = await authedFetch(admin.token)("/admin/users", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        role: "SUPERUSER",
        name: "Sneaky",
        email: "sneaky@example.com",
        password: PASSWORD,
      }),
    });

    expect(res.status).toBe(400);
  });

  it("refuses ADMIN as a creatable role", async () => {
    const admin = await login(ADMIN, PASSWORD);

    const res = await authedFetch(admin.token)("/admin/users", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        role: "ADMIN",
        name: "Second Admin",
        email: "second@kartavya.gov",
        password: PASSWORD,
      }),
    });

    expect(res.status).toBe(400);
  });

  it("refuses an override to a status that does not exist", async () => {
    const citizen = await login(CITIZEN, PASSWORD);
    const admin = await login(ADMIN, PASSWORD);
    const complaint = await fileComplaint(citizen.token);

    const res = await authedFetch(admin.token)(`/admin/complaints/${complaint.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: "NOT_A_STATUS", reason: "probe" }),
    });

    expect(res.status).toBe(400);
    const after = await authedFetch(citizen.token)(`/complaints/${complaint.id}`);
    expect((await after.json()).status).toBe("SUBMITTED");
  });

  it.each([
    ["citizen", CITIZEN, "/complaints/my?status=NOPE"],
    ["officer", OFFICER, "/officer/complaints?status=NOPE"],
    ["officer", OFFICER, "/officer/complaints?slaLabel=NOPE"],
    ["officer", OFFICER, "/officer/complaints?severityLabel=NOPE"],
    ["admin", ADMIN, "/admin/complaints?status=NOPE"],
    ["admin", ADMIN, "/admin/complaints?slaLabel=NOPE"],
    ["admin", ADMIN, "/admin/users?role=NOPE"],
    ["admin", ADMIN, "/admin/export/complaints?status=NOPE"],
    ["admin", ADMIN, "/admin/officers/2/performance?period=weekly"],
    ["citizen", CITIZEN, "/leaderboard?scope=zone&period=weekly"],
  ])("refuses a bad enum in a query param (%s %s)", async (_role, email, path) => {
    const session = await login(email, PASSWORD);
    const res = await authedFetch(session.token)(path);
    expect(res.status).toBe(400);
  });

  it("still accepts the documented query values", async () => {
    const officer = await login(OFFICER, PASSWORD);
    const api = authedFetch(officer.token);
    for (const path of [
      "/officer/complaints?status=SUBMITTED&status=UNDER_REVIEW",
      "/officer/complaints?slaLabel=ON_TIME",
      "/officer/complaints?severityLabel=LOW",
      "/officer/complaints",
    ]) {
      expect((await api(path)).status, path).toBe(200);
    }
  });
});

describe("admin-initiated password reset", () => {
  it("lets the user sign in with the new password and not the old one", async () => {
    const admin = await login(ADMIN, PASSWORD);
    const citizen = await login(CITIZEN, PASSWORD);

    const res = await authedFetch(admin.token)(
      `/admin/users/${citizen.user.id}/reset-password`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ newPassword: "brand-new-password" }),
      },
    );
    expect(res.status).toBe(204);

    const fresh = await fetch("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: CITIZEN, password: "brand-new-password" }),
    });
    expect(fresh.status).toBe(200);

    const stale = await fetch("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: CITIZEN, password: PASSWORD }),
    });
    expect(stale.status).toBe(401);
  });

  it("rejects a short password and 404s an unknown user", async () => {
    const admin = await login(ADMIN, PASSWORD);
    const citizen = await login(CITIZEN, PASSWORD);
    const api = authedFetch(admin.token);

    const short = await api(`/admin/users/${citizen.user.id}/reset-password`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ newPassword: "short" }),
    });
    expect(short.status).toBe(400);

    const missing = await api("/admin/users/999999/reset-password", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ newPassword: "brand-new-password" }),
    });
    expect(missing.status).toBe(404);
  });

  it("is admin-only", async () => {
    const officer = await login(OFFICER, PASSWORD);
    const citizen = await login(CITIZEN, PASSWORD);

    const res = await authedFetch(officer.token)(
      `/admin/users/${citizen.user.id}/reset-password`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ newPassword: "brand-new-password" }),
      },
    );

    expect(res.status).toBe(403);
  });
});
