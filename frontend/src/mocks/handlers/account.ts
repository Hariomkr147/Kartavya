import { http, HttpResponse } from "msw";
import { db, persist } from "../db/store";
import { toUser } from "../serializers";
import { requireAuth, Errors } from "../lib/http";
import type { UpdateProfileRequest, ChangePasswordRequest } from "../../types/api";

const BASE = "/api/v1";

export const accountHandlers = [
  http.get(`${BASE}/users/me`, ({ request }) => {
    const auth = requireAuth(request);
    if (!auth.ok) return auth.response;
    return HttpResponse.json(toUser(auth.user));
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
    return HttpResponse.json(toUser(auth.user));
  }),

  http.post(`${BASE}/users/me/change-password`, async ({ request }) => {
    const auth = requireAuth(request);
    if (!auth.ok) return auth.response;
    const body = (await request.json()) as ChangePasswordRequest;

    if (body.currentPassword !== auth.user.password) {
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
];
