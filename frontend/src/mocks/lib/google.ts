/**
 * Stand-in for a Google ID token in mock mode. The real backend verifies a
 * Google-signed RS256 JWT; here a token is `mock-google.<base64 JSON>` and
 * anything else is a 401, so a typo cannot sign anyone in.
 */
export interface MockGoogleIdentity {
  sub: string;
  email: string;
  name?: string | null;
}

const PREFIX = "mock-google.";

export function mockGoogleToken(identity: MockGoogleIdentity): string {
  return PREFIX + btoa(JSON.stringify(identity));
}

export function decodeMockGoogleToken(token: unknown): MockGoogleIdentity | null {
  if (typeof token !== "string" || !token.startsWith(PREFIX)) return null;
  try {
    const identity = JSON.parse(atob(token.slice(PREFIX.length)));
    if (typeof identity?.sub !== "string" || typeof identity?.email !== "string")
      return null;
    if (!identity.sub || !identity.email) return null;
    return { ...identity, email: identity.email.trim().toLowerCase() };
  } catch {
    return null;
  }
}
