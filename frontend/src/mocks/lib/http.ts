import { HttpResponse } from "msw";
import { db } from "../db/store";
import { decodeToken, bearerTokenFrom } from "./token";
import type { UserRole, UserRow } from "../db/types";

export interface ApiErrorDetail {
  field: string;
  issue: string;
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: ApiErrorDetail[],
) {
  return HttpResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}

export const Errors = {
  unauthorized: () => errorResponse(401, "UNAUTHORIZED", "No valid token was provided."),
  forbidden: (message = "You are not allowed to do this.") =>
    errorResponse(403, "FORBIDDEN", message),
  notFound: (message = "The requested resource does not exist.") =>
    errorResponse(404, "NOT_FOUND", message),
  badRequest: (message: string, details?: ApiErrorDetail[]) =>
    errorResponse(400, "VALIDATION_ERROR", message, details),
  conflict: (code: string, message: string) => errorResponse(409, code, message),
};

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export function parsePagination(url: URL): PaginationParams {
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("pageSize")) || 20),
  );
  return { page, pageSize };
}

export function paginate<T>(items: T[], { page, pageSize }: PaginationParams) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = (page - 1) * pageSize;
  return {
    data: items.slice(start, start + pageSize),
    pagination: { page, pageSize, totalItems, totalPages },
  };
}

/** Authenticates the request; returns null if there's no valid bearer token. */
export function authenticate(request: Request): UserRow | null {
  const token = bearerTokenFrom(request);
  if (!token) return null;
  const payload = decodeToken(token);
  if (!payload) return null;
  const user = db.users.find((u) => u.id === payload.userId);
  if (!user || !user.isActive) return null;
  return user;
}

export type AuthResult = { ok: true; user: UserRow } | { ok: false; response: Response };

/** Requires any authenticated user, of any role. */
export function requireAuth(request: Request): AuthResult {
  const user = authenticate(request);
  if (!user) return { ok: false, response: Errors.unauthorized() };
  return { ok: true, user };
}

/** Requires an authenticated user whose role is one of `roles`. */
export function requireRole(request: Request, ...roles: UserRole[]): AuthResult {
  const auth = requireAuth(request);
  if (!auth.ok) return auth;
  if (!roles.includes(auth.user.role)) {
    return { ok: false, response: Errors.forbidden() };
  }
  return auth;
}
