/**
 * Mock-only bearer token. NOT a real JWT, NOT cryptographically signed —
 * this only exists so the MSW layer can identify "who is calling" while the
 * real backend doesn't exist. Never treat this as a model for real auth.
 */
import type { UserRole } from "../db/types";

const TOKEN_PREFIX = "mock-token.";

interface TokenPayload {
  userId: number;
  role: UserRole;
}

export function issueToken(user: { id: number; role: UserRole }): string {
  const payload: TokenPayload = { userId: user.id, role: user.role };
  return TOKEN_PREFIX + btoa(JSON.stringify(payload));
}

export function decodeToken(token: string): TokenPayload | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  try {
    const payload = JSON.parse(atob(token.slice(TOKEN_PREFIX.length)));
    if (typeof payload?.userId === "number" && typeof payload?.role === "string") {
      return payload as TokenPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export function bearerTokenFrom(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}
