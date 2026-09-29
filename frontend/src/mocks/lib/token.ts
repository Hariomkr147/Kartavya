/**
 * Mock-only bearer token. NOT a real JWT, NOT cryptographically signed —
 * this only exists so the MSW layer can identify "who is calling" while the
 * real backend doesn't exist. Never treat this as a model for real auth.
 */
import type { UserRole } from "../db/types";

const TOKEN_PREFIX = "mock-token.";

/** The contract's `JWT_TTL_HOURS`, default 24 h. */
const TOKEN_TTL_HOURS = 24;

interface TokenPayload {
  userId: number;
  role: UserRole;
  /** Expiry, epoch seconds — stands in for the real JWT's `exp` claim. */
  exp: number;
}

export interface IssuedToken {
  token: string;
  /** ISO timestamp mirroring `exp`, returned to the client as `expiresAt`. */
  expiresAt: string;
}

export function issueToken(user: { id: number; role: UserRole }): IssuedToken {
  const expiresAtMs = Date.now() + TOKEN_TTL_HOURS * 3600_000;
  const payload: TokenPayload = {
    userId: user.id,
    role: user.role,
    exp: Math.floor(expiresAtMs / 1000),
  };
  return {
    token: TOKEN_PREFIX + btoa(JSON.stringify(payload)),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

/**
 * Returns null for a malformed *or expired* token. There is no refresh
 * endpoint by design: once `exp` passes, every request 401s and the client
 * sends the user back to the login screen.
 */
export function decodeToken(token: string): TokenPayload | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  try {
    const payload = JSON.parse(atob(token.slice(TOKEN_PREFIX.length)));
    if (typeof payload?.userId !== "number" || typeof payload?.role !== "string") {
      return null;
    }
    // Tokens minted before expiry existed have no `exp`; treat them as stale
    // rather than eternal, so a persisted mock session cannot outlive the rule.
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
      return null;
    }
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

export function bearerTokenFrom(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

// --- MFA ticket ---------------------------------------------------------------
// A half-finished login. Its prefix differs from `mock-token.`, so `decodeToken`
// rejects it outright — the mock equivalent of the backend refusing `typ: mfa`
// as a bearer token.

const TICKET_PREFIX = "mock-mfa.";
const TICKET_TTL_MS = 5 * 60_000;

export function issueMfaTicket(user: { id: number }): {
  ticket: string;
  expiresAt: string;
} {
  const expiresAtMs = Date.now() + TICKET_TTL_MS;
  return {
    ticket: TICKET_PREFIX + btoa(JSON.stringify({ userId: user.id, exp: expiresAtMs })),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

/** The user id a live ticket names, or null for anything else (expired, malformed, a session). */
export function decodeMfaTicket(ticket: string): number | null {
  if (!ticket.startsWith(TICKET_PREFIX)) return null;
  try {
    const payload = JSON.parse(atob(ticket.slice(TICKET_PREFIX.length)));
    if (typeof payload?.userId !== "number" || typeof payload?.exp !== "number")
      return null;
    return payload.exp > Date.now() ? payload.userId : null;
  } catch {
    return null;
  }
}
