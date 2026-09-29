// @vitest-environment node
// See lifecycle.test.ts for why this runs in the node environment.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { server } from "../server";
import { resetDatabase } from "../db/store";
import { authedFetch, login } from "../test-utils";
import { codeAt } from "../lib/totp";
import { mockGoogleToken } from "../lib/google";

const BASE = "http://localhost/api/v1";
const PASSWORD = "password123";
const CITIZEN = "asha@example.com";
const OFFICER = "officer.ward12@kartavya.gov";
const ADMIN = "admin@kartavya.gov";
const JSON_HEADERS = { "Content-Type": "application/json" };

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  resetDatabase();
});
afterAll(() => server.close());

function post(path: string, body: unknown, token?: string) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...JSON_HEADERS, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

const rawLogin = (email: string) => post("/auth/login", { email, password: PASSWORD });

/** Turns 2FA on for `email` through the real endpoints. Returns the secret and a live session. */
async function enrol(email: string) {
  const { token } = await login(email, PASSWORD);
  const setup = (await (
    await post("/users/me/mfa", { method: "TOTP" }, token)
  ).json()) as {
    secret: string;
    otpauthUri: string;
  };
  const confirm = await post(
    "/users/me/mfa/confirm",
    { code: await codeAt(setup.secret, Date.now()) },
    token,
  );
  expect(confirm.status).toBe(200);
  return { secret: setup.secret, token };
}

async function ticketFor(email: string) {
  const res = await rawLogin(email);
  expect(res.status).toBe(202);
  return ((await res.json()) as { mfaTicket: string }).mfaTicket;
}

describe("login without 2FA is unchanged", () => {
  it("returns exactly today's AuthResponse", async () => {
    const res = await rawLogin(CITIZEN);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "token", "tokenType", "user"]);
  });

  it("carries the new derived flags on the user", async () => {
    const citizen = (await (await rawLogin(CITIZEN)).json()).user;
    expect(citizen).toMatchObject({
      mfaEnabled: false,
      mfaMethod: null,
      mfaRecommended: false,
      hasPassword: true,
      googleLinked: false,
    });
    const officer = (await (await rawLogin(OFFICER)).json()).user;
    expect(officer.mfaRecommended).toBe(true);
  });

  it("does not put sign-in flags on a complaint's reporter block", async () => {
    const admin = await login(ADMIN, PASSWORD);
    const list = await (
      await authedFetch(admin.token)("/admin/complaints?pageSize=1")
    ).json();
    const id = list.data[0].id as string;
    const detail = await (await authedFetch(admin.token)(`/complaints/${id}`)).json();
    expect(Object.keys(detail.reporter).sort()).toEqual(
      [
        "active",
        "createdAt",
        "displayName",
        "email",
        "id",
        "name",
        "role",
        "zoneId",
      ].sort(),
    );
  });
});

describe("setup, login and the ticket", () => {
  it("a pending setup does not change login", async () => {
    const { token } = await login(CITIZEN, PASSWORD);
    await post("/users/me/mfa", { method: "TOTP" }, token);
    expect((await rawLogin(CITIZEN)).status).toBe(200);
    const me = await (await authedFetch(token)("/users/me")).json();
    expect(me.mfaEnabled).toBe(false);
  });

  it("logs in with a code, and the ticket is not a session", async () => {
    const { secret } = await enrol(CITIZEN);
    const ticket = await ticketFor(CITIZEN);

    const asBearer = await authedFetch(ticket)("/users/me");
    expect(asBearer.status).toBe(401);

    const res = await post("/auth/mfa/verify", {
      mfaTicket: ticket,
      code: await codeAt(secret, Date.now(), 1),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.mfaEnabled).toBe(true);
    expect((await authedFetch(body.token)("/users/me")).status).toBe(200);
  });

  it("refuses a replayed code and a code from two steps away", async () => {
    const { secret } = await enrol(CITIZEN);
    const ticket = await ticketFor(CITIZEN);
    const far = await post("/auth/mfa/verify", {
      mfaTicket: ticket,
      code: await codeAt(secret, Date.now(), 5),
    });
    expect(far.status).toBe(401);
    expect((await far.json()).error.code).toBe("INVALID_CODE");

    const code = await codeAt(secret, Date.now(), 1);
    expect((await post("/auth/mfa/verify", { mfaTicket: ticket, code })).status).toBe(
      200,
    );
    expect((await post("/auth/mfa/verify", { mfaTicket: ticket, code })).status).toBe(
      401,
    );
  });

  it("locks after five wrong codes, even against the right one", async () => {
    const { secret } = await enrol(CITIZEN);
    const ticket = await ticketFor(CITIZEN);
    const wrong = await codeAt(secret, Date.now(), 5);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push(
        (await post("/auth/mfa/verify", { mfaTicket: ticket, code: wrong })).status,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    const right = await post("/auth/mfa/verify", {
      mfaTicket: ticket,
      code: await codeAt(secret, Date.now(), 1),
    });
    expect(right.status).toBe(429);
    expect((await right.json()).error.code).toBe("MFA_LOCKED");
  });

  it("validates bodies like the backend's Pydantic models", async () => {
    const ticket = await (async () => (await enrol(CITIZEN), ticketFor(CITIZEN)))();
    for (const code of ["12", "1234567", "abcdef", "", 123456]) {
      const res = await post("/auth/mfa/verify", { mfaTicket: ticket, code });
      expect(res.status).toBe(400);
    }
    expect((await post("/auth/mfa/verify", { code: "123456" })).status).toBe(400);
    expect(
      (await post("/auth/mfa/verify", { mfaTicket: "junk", code: "123456" })).status,
    ).toBe(401);
    const { token } = await login(OFFICER, PASSWORD);
    expect((await post("/users/me/mfa", { method: "SMS" }, token)).status).toBe(400);
    expect((await post("/users/me/mfa", {}, token)).status).toBe(400);
  });

  it("a wrong code in a live session is 400 and never logs the user out", async () => {
    const { secret, token } = await enrol(CITIZEN);
    const res = await post(
      "/users/me/mfa/disable",
      { code: await codeAt(secret, Date.now(), 5) },
      token,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_CODE");
    expect((await authedFetch(token)("/users/me")).status).toBe(200);
  });

  it("disables with a current code, and state errors are 409", async () => {
    const { token } = await login(CITIZEN, PASSWORD);
    expect((await post("/users/me/mfa/confirm", { code: "123456" }, token)).status).toBe(
      409,
    );
    expect((await post("/users/me/mfa/disable", { code: "123456" }, token)).status).toBe(
      409,
    );

    const { secret, token: t2 } = await enrol(OFFICER);
    expect((await post("/users/me/mfa", { method: "TOTP" }, t2)).status).toBe(409);
    const off = await post(
      "/users/me/mfa/disable",
      { code: await codeAt(secret, Date.now(), 1) },
      t2,
    );
    expect(off.status).toBe(204);
    expect((await rawLogin(OFFICER)).status).toBe(200);
  });

  it("requires a session for the account endpoints", async () => {
    for (const path of [
      "/users/me/mfa",
      "/users/me/mfa/confirm",
      "/users/me/mfa/disable",
    ]) {
      expect((await post(path, {})).status).toBe(401);
    }
  });
});

describe("admin reset", () => {
  it("is admin-only, idempotent, and puts login back to normal", async () => {
    await enrol(CITIZEN);
    const admin = await login(ADMIN, PASSWORD);
    const citizen = await login(OFFICER, PASSWORD); // any non-admin
    const list = await (
      await authedFetch(admin.token)("/admin/users?pageSize=100")
    ).json();
    const target = list.data.find((u: { email: string }) => u.email === CITIZEN);
    expect(target.mfaEnabled).toBe(true);

    const url = `/admin/users/${target.id}/mfa-reset`;
    expect((await post(url, {})).status).toBe(401);
    expect((await authedFetch(citizen.token)(url, { method: "POST" })).status).toBe(403);
    expect((await authedFetch(admin.token)(url, { method: "POST" })).status).toBe(204);
    expect((await authedFetch(admin.token)(url, { method: "POST" })).status).toBe(204);
    expect(
      (await authedFetch(admin.token)("/admin/users/99999/mfa-reset", { method: "POST" }))
        .status,
    ).toBe(404);
    expect((await rawLogin(CITIZEN)).status).toBe(200);
  });
});

describe("Google sign-in", () => {
  const google = (email: string, sub = `sub-${email}`, name = "Riya Rao") =>
    mockGoogleToken({ sub, email, name });

  it("signs a new citizen up, then in, and they cannot use a password", async () => {
    const created = await post("/auth/google", {
      idToken: google("riya@example.com"),
      zoneId: "2",
    });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.user).toMatchObject({
      role: "CITIZEN",
      hasPassword: false,
      googleLinked: true,
    });

    const again = await post("/auth/google", { idToken: google("riya@example.com") });
    expect(again.status).toBe(200);

    for (const password of [PASSWORD, "!", ""]) {
      const res = await post("/auth/login", { email: "riya@example.com", password });
      expect(res.status).toBe(401);
    }
  });

  it("asks for a zone before creating anything", async () => {
    const res = await post("/auth/google", { idToken: google("nozone@example.com") });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("ZONE_REQUIRED");
    expect(
      (
        await post("/auth/google", {
          idToken: google("nozone@example.com"),
          zoneId: "999",
        })
      ).status,
    ).toBe(400);
  });

  it("links an existing citizen by email but never staff", async () => {
    const linked = await post("/auth/google", { idToken: google(CITIZEN) });
    expect(linked.status).toBe(200);
    expect((await linked.json()).user.googleLinked).toBe(true);

    for (const email of [OFFICER, ADMIN]) {
      const res = await post("/auth/google", { idToken: google(email) });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("GOOGLE_LINK_REQUIRED");
    }
  });

  it("lets staff link from their account, then sign in — and 2FA still applies", async () => {
    const { token } = await login(OFFICER, PASSWORD);
    const link = await post("/users/me/google", { idToken: google(OFFICER) }, token);
    expect(link.status).toBe(200);
    expect((await post("/auth/google", { idToken: google(OFFICER) })).status).toBe(200);

    const { secret } = await enrol(OFFICER);
    const challenge = await post("/auth/google", { idToken: google(OFFICER) });
    expect(challenge.status).toBe(202);
    const { mfaTicket } = await challenge.json();
    const done = await post("/auth/mfa/verify", {
      mfaTicket,
      code: await codeAt(secret, Date.now(), 1),
    });
    expect(done.status).toBe(200);
  });

  it("rejects bad tokens and validates the body", async () => {
    expect((await post("/auth/google", { idToken: "junk" })).status).toBe(401);
    expect((await post("/auth/google", {})).status).toBe(400);
    expect((await post("/auth/google", { idToken: "" })).status).toBe(400);
  });

  it("link and unlink follow the backend's conflict rules", async () => {
    const { token } = await login(CITIZEN, PASSWORD);
    const del = (t: string) => authedFetch(t)("/users/me/google", { method: "DELETE" });
    expect((await del(token)).status).toBe(409); // nothing linked
    expect(
      (await post("/users/me/google", { idToken: google(CITIZEN, "g-1") }, token)).status,
    ).toBe(200);
    expect(
      (await post("/users/me/google", { idToken: google(CITIZEN, "g-2") }, token)).status,
    ).toBe(409);

    const other = await login("kiran@example.com", PASSWORD);
    expect(
      (await post("/users/me/google", { idToken: google(CITIZEN, "g-1") }, other.token))
        .status,
    ).toBe(409);

    expect((await del(token)).status).toBe(204); // has a password
    expect((await post("/users/me/google", { idToken: "junk" }, token)).status).toBe(401);
  });

  it("refuses to unlink when Google is the only way in", async () => {
    const created = await (
      await post("/auth/google", { idToken: google("solo@example.com"), zoneId: "2" })
    ).json();
    const res = await authedFetch(created.token)("/users/me/google", {
      method: "DELETE",
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NO_OTHER_LOGIN");
    const change = await post(
      "/users/me/change-password",
      { currentPassword: "!", newPassword: "newpassword1" },
      created.token,
    );
    expect(change.status).toBe(401);
  });
});
