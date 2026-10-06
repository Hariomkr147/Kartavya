import { http, HttpResponse } from "msw";
import { db, persist } from "../db/store";
import { hasPassword, toSessionUser } from "../serializers";
import { requireAuth, Errors, errorResponse } from "../lib/http";
import { checkCode } from "../lib/mfa";
import { generateSecret, otpauthUri } from "../lib/totp";
import { decodeMockGoogleToken } from "../lib/google";
import { checkEnum, MFA_METHODS } from "../lib/enums";
import type {
  UpdateProfileRequest,
  ChangePasswordRequest,
  LinkGoogleRequest,
  MfaCodeRequest,
  MfaSetupRequest,
} from "../../types/api";

const BASE = "/api/v1";

const SIX_DIGITS = /^[0-9]{6}$/;

/** A wrong code inside a live session is a 400, never a 401 — the session is fine. */
const wrongCodeInSession = () =>
  errorResponse(400, "INVALID_CODE", "That code is not right.");

function badCode(body: MfaCodeRequest) {
  if (typeof body.code !== "string" || !SIX_DIGITS.test(body.code)) {
    return Errors.badRequest("code must be 6 digits.", [
      { field: "code", issue: "must be 6 digits" },
    ]);
  }
  return null;
}

export const accountHandlers = [
  http.get(`${BASE}/users/me`, ({ request }) => {
    const auth = requireAuth(request);
    if (!auth.ok) return auth.response;
    return HttpResponse.json(toSessionUser(auth.user));
  }),

  http.patch(`${BASE}/users/me`, async ({ request }) => {
    const auth = requireAuth(request);
    if (!auth.ok) return auth.response;
    const body = (await request.json()) as UpdateProfileRequest;

    if (body.zoneId !== undefined && auth.user.role === "OFFICER") {
      return Errors.forbidden(
        "Your zone is a work assignment — ask an admin to reassign it, not a self-service change.",
      );
    }
    if (body.email && body.email.toLowerCase() !== auth.user.email.toLowerCase()) {
      if (
        db.users.some(
          (u) =>
            u.id !== auth.user.id && u.email.toLowerCase() === body.email!.toLowerCase(),
        )
      ) {
        return HttpResponse.json(
          {
            error: {
              code: "EMAIL_TAKEN",
              message: "The new email is already taken by another account.",
            },
          },
          { status: 409 },
        );
      }
      auth.user.email = body.email.trim();
    }
    if (body.displayName !== undefined) auth.user.displayName = body.displayName;
    if (body.name !== undefined && body.name.trim())
      auth.user.fullName = body.name.trim();
    if (body.zoneId !== undefined && auth.user.role === "CITIZEN") {
      const zoneId = Number(body.zoneId);
      if (!db.zones.some((z) => z.id === zoneId)) {
        return Errors.badRequest("zoneId does not refer to a known zone.");
      }
      auth.user.zoneId = zoneId;
    }
    persist();
    return HttpResponse.json(toSessionUser(auth.user));
  }),

  http.post(`${BASE}/users/me/change-password`, async ({ request }) => {
    const auth = requireAuth(request);
    if (!auth.ok) return auth.response;
    const body = (await request.json()) as ChangePasswordRequest;

    if (!hasPassword(auth.user) || body.currentPassword !== auth.user.password) {
      return HttpResponse.json(
        { error: { code: "WRONG_PASSWORD", message: "Current password is incorrect." } },
        { status: 401 },
      );
    }
    if (!body.newPassword || body.newPassword.length < 8) {
      return Errors.badRequest("New password must be at least 8 characters.");
    }
    auth.user.password = body.newPassword;
    persist();
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${BASE}/users/me/mfa`, async ({ request }) => {
    const auth = requireAuth(request);
    if (!auth.ok) return auth.response;
    const body = (await request.json()) as MfaSetupRequest;
    const problem = checkEnum("method", body.method, MFA_METHODS);
    if (problem) return problem;

    const user = auth.user;
    if (user.mfa && !user.mfa.pending) {
      return Errors.conflict(
        "MFA_ALREADY_ENABLED",
        "Two-step verification is already on. Turn it off first.",
      );
    }
    // Stores a PENDING state: it is not on, and login ignores it, until confirmed.
    const secret = generateSecret();
    user.mfa = {
      method: body.method,
      secret,
      lastStep: 0,
      failed: 0,
      lockedUntil: null,
      pending: true,
    };
    persist();
    return HttpResponse.json(
      { method: body.method, otpauthUri: otpauthUri(secret, user.email), secret },
      { status: 201 },
    );
  }),

  http.post(`${BASE}/users/me/mfa/confirm`, async ({ request }) => {
    const auth = requireAuth(request);
    if (!auth.ok) return auth.response;
    const body = (await request.json()) as MfaCodeRequest;
    const invalid = badCode(body);
    if (invalid) return invalid;

    const user = auth.user;
    if (user.mfa && !user.mfa.pending) {
      return Errors.conflict(
        "MFA_ALREADY_ENABLED",
        "Two-step verification is already on.",
      );
    }
    if (!user.mfa) {
      return Errors.conflict(
        "NO_PENDING_SETUP",
        "Start setting up two-step verification first.",
      );
    }
    const problem = await checkCode(user, body.code, wrongCodeInSession);
    if (problem) return problem;
    user.mfa.pending = false;
    persist();
    return HttpResponse.json(toSessionUser(user));
  }),

  http.post(`${BASE}/users/me/mfa/disable`, async ({ request }) => {
    const auth = requireAuth(request);
    if (!auth.ok) return auth.response;
    const body = (await request.json()) as MfaCodeRequest;
    const invalid = badCode(body);
    if (invalid) return invalid;

    const user = auth.user;
    if (!user.mfa || user.mfa.pending) {
      return Errors.conflict("MFA_NOT_ENABLED", "Two-step verification is not on.");
    }
    const problem = await checkCode(user, body.code, wrongCodeInSession);
    if (problem) return problem;
    user.mfa = null;
    persist();
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${BASE}/users/me/google`, async ({ request }) => {
    const auth = requireAuth(request);
    if (!auth.ok) return auth.response;
    const body = (await request.json()) as LinkGoogleRequest;
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
    if (auth.user.googleSub) {
      return Errors.conflict(
        "GOOGLE_ALREADY_LINKED",
        "A Google account is already linked.",
      );
    }
    if (db.users.some((u) => u.googleSub === identity.sub && u.id !== auth.user.id)) {
      return Errors.conflict(
        "GOOGLE_ALREADY_LINKED",
        "That Google account is already linked to another user.",
      );
    }
    auth.user.googleSub = identity.sub;
    persist();
    return HttpResponse.json(toSessionUser(auth.user));
  }),

  http.delete(`${BASE}/users/me/google`, ({ request }) => {
    const auth = requireAuth(request);
    if (!auth.ok) return auth.response;
    if (!auth.user.googleSub) {
      return Errors.conflict("GOOGLE_NOT_LINKED", "No Google account is linked.");
    }
    if (!hasPassword(auth.user)) {
      return Errors.conflict(
        "NO_OTHER_LOGIN",
        "Google is the only way you can log in, so it cannot be unlinked.",
      );
    }
    auth.user.googleSub = null;
    persist();
    return new HttpResponse(null, { status: 204 });
  }),
];
