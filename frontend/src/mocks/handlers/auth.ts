import { http, HttpResponse } from "msw";
import { db, persist, nextId } from "../db/store";
import { hasPassword, toSessionUser } from "../serializers";
import { decodeMfaTicket, issueMfaTicket, issueToken } from "../lib/token";
import { checkAndAwardBadges } from "../lib/points";
import { Errors, errorResponse } from "../lib/http";
import { checkCode } from "../lib/mfa";
import { decodeMockGoogleToken } from "../lib/google";
import type { UserRow } from "../db/types";
import type {
  GoogleSignInRequest,
  LoginRequest,
  MfaVerifyRequest,
  RegisterRequest,
} from "../../types/api";

const BASE = "/api/v1";

/**
 * The one funnel after any first login step — the mock twin of the backend's
 * `complete_primary_auth`. 2FA off (or only pending) is exactly the response
 * login always returned; 2FA on is a 202 challenge and no session.
 */
function completePrimaryAuth(user: UserRow, sessionStatus = 200) {
  if (user.mfa && !user.mfa.pending) {
    const { ticket, expiresAt } = issueMfaTicket(user);
    return HttpResponse.json(
      { mfaRequired: true, mfaTicket: ticket, method: user.mfa.method, expiresAt },
      { status: 202 },
    );
  }
  return sessionResponse(user, sessionStatus);
}

function sessionResponse(user: UserRow, status = 200) {
  // Badge/rank state (e.g. ZONE_CHAMPION) can shift due to other citizens'
  // activity between sessions — cheap enough to re-check on every login.
  if (user.role === "CITIZEN") checkAndAwardBadges(user.id);
  const { token, expiresAt } = issueToken(user);
  return HttpResponse.json(
    { token, tokenType: "Bearer", expiresAt, user: toSessionUser(user) },
    { status },
  );
}

const SIX_DIGITS = /^[0-9]{6}$/;

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

    const { token, expiresAt } = issueToken(user);
    return HttpResponse.json(
      { token, tokenType: "Bearer", expiresAt, user: toSessionUser(user) },
      { status: 201 },
    );
  }),

  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as LoginRequest;
    const user = db.users.find(
      (u) => u.email.toLowerCase() === body.email?.toLowerCase(),
    );

    if (!user || !hasPassword(user) || user.password !== body.password) {
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

    return completePrimaryAuth(user);
  }),

  http.post(`${BASE}/auth/mfa/verify`, async ({ request }) => {
    const body = (await request.json()) as MfaVerifyRequest;
    if (typeof body.mfaTicket !== "string" || !body.mfaTicket) {
      return Errors.badRequest("mfaTicket is required.", [
        { field: "mfaTicket", issue: "is required" },
      ]);
    }
    if (typeof body.code !== "string" || !SIX_DIGITS.test(body.code)) {
      return Errors.badRequest("code must be 6 digits.", [
        { field: "code", issue: "must be 6 digits" },
      ]);
    }

    const userId = decodeMfaTicket(body.mfaTicket);
    const user = userId === null ? undefined : db.users.find((u) => u.id === userId);
    if (!user || !user.isActive || !user.mfa || user.mfa.pending) {
      return errorResponse(401, "UNAUTHORIZED", "Invalid or expired sign-in session.");
    }

    const problem = await checkCode(user, body.code, () =>
      errorResponse(401, "INVALID_CODE", "That code is not right."),
    );
    return problem ?? sessionResponse(user);
  }),

  http.post(`${BASE}/auth/google`, async ({ request }) => {
    const body = (await request.json()) as GoogleSignInRequest;
    if (typeof body.idToken !== "string" || !body.idToken) {
      return Errors.badRequest("idToken is required.", [
        { field: "idToken", issue: "is required" },
      ]);
    }
    const identity = decodeMockGoogleToken(body.idToken);
    if (!identity) {
      return errorResponse(
        401,
        "UNAUTHORIZED",
        "Google sign-in failed. Please try again.",
      );
    }

    let user = db.users.find((u) => u.googleSub === identity.sub);
    let created = false;

    if (!user) {
      user = db.users.find((u) => u.email.toLowerCase() === identity.email);
      if (user) {
        if (!user.isActive) {
          return errorResponse(401, "UNAUTHORIZED", "Your account is no longer active.");
        }
        if (user.role !== "CITIZEN") {
          return errorResponse(
            403,
            "GOOGLE_LINK_REQUIRED",
            "Log in with your password, then link Google from your account page.",
          );
        }
        if (user.googleSub) {
          return Errors.conflict(
            "GOOGLE_ALREADY_LINKED",
            "This account is linked to a different Google account.",
          );
        }
        user.googleSub = identity.sub;
      } else {
        if (body.zoneId === undefined || body.zoneId === null) {
          return Errors.conflict(
            "ZONE_REQUIRED",
            "Choose your home zone to finish signing up.",
          );
        }
        const zoneId = Number(body.zoneId);
        if (!db.zones.some((z) => z.id === zoneId)) {
          return Errors.badRequest("zoneId does not refer to a known zone.");
        }
        user = {
          id: nextId("users"),
          fullName: (identity.name?.trim() || identity.email.split("@")[0]).slice(0, 120),
          displayName: null,
          email: identity.email,
          // The marker, not a password: no typed password can ever equal it.
          password: `!${crypto.randomUUID()}`,
          role: "CITIZEN",
          zoneId,
          isActive: true,
          createdAt: new Date().toISOString(),
          googleSub: identity.sub,
        };
        db.users.push(user);
        created = true;
      }
      persist();
    }

    if (!user.isActive) {
      return errorResponse(401, "UNAUTHORIZED", "Your account is no longer active.");
    }
    return completePrimaryAuth(user, created ? 201 : 200);
  }),
];
