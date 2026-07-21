import { http, HttpResponse } from "msw";
import { db, persist, nextId } from "../db/store";
import { toUser } from "../serializers";
import { issueToken } from "../lib/token";
import { checkAndAwardBadges } from "../lib/points";
import { Errors } from "../lib/http";
import type { RegisterRequest, LoginRequest } from "../../types/api";

const BASE = "/api/v1";

export const authHandlers = [
  http.post(`${BASE}/auth/register`, async ({ request }) => {
    const body = (await request.json()) as RegisterRequest;

    if (!body.name?.trim() || !body.email?.trim() || !body.password || !body.zoneId) {
      return Errors.badRequest("name, email, password, and zoneId are all required.");
    }
    if (body.password.length < 8) {
      return Errors.badRequest("Password must be at least 8 characters.", [
        { field: "password", issue: "must be at least 8 characters" },
      ]);
    }
    if (db.users.some((u) => u.email.toLowerCase() === body.email.toLowerCase())) {
      return HttpResponse.json(
        {
          error: {
            code: "EMAIL_TAKEN",
            message: "An account with this email already exists.",
          },
        },
        { status: 409 },
      );
    }
    const zoneId = Number(body.zoneId);
    if (!db.zones.some((z) => z.id === zoneId)) {
      return Errors.badRequest("zoneId does not refer to a known zone.");
    }

    const user = {
      id: nextId("users"),
      fullName: body.name.trim(),
      displayName: null,
      email: body.email.trim(),
      password: body.password,
      role: "CITIZEN" as const,
      zoneId,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    persist();

    return HttpResponse.json(
      { token: issueToken(user), tokenType: "Bearer", user: toUser(user) },
      { status: 201 },
    );
  }),

  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as LoginRequest;
    const user = db.users.find(
      (u) => u.email.toLowerCase() === body.email?.toLowerCase(),
    );

    if (!user || user.password !== body.password) {
      return HttpResponse.json(
        { error: { code: "INVALID_CREDENTIALS", message: "Wrong email or password." } },
        { status: 401 },
      );
    }
    if (!user.isActive) {
      return HttpResponse.json(
        {
          error: {
            code: "ACCOUNT_DEACTIVATED",
            message: "This account has been deactivated.",
          },
        },
        { status: 401 },
      );
    }

    // Badge/rank state (e.g. ZONE_CHAMPION) can shift due to other citizens'
    // activity between sessions — cheap enough to re-check on every login.
    if (user.role === "CITIZEN") checkAndAwardBadges(user.id);

    return HttpResponse.json({
      token: issueToken(user),
      tokenType: "Bearer",
      user: toUser(user),
    });
  }),
];
