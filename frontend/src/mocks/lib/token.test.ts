import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeToken, issueToken } from "./token";

const HOUR = 3600 * 1000;
const USER = { id: 7, role: "CITIZEN" as const };

afterEach(() => vi.useRealTimers());

describe("issueToken", () => {
  it("reports an expiry that mirrors the token's own exp claim", () => {
    const before = Date.now();
    const { token, expiresAt } = issueToken(USER);
    const after = Date.now();

    const expiresAtMs = Date.parse(expiresAt);
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + 24 * HOUR);
    expect(expiresAtMs).toBeLessThanOrEqual(after + 24 * HOUR);

    // Same moment the server will enforce, so a client can pre-empt expiry
    // without decoding the token.
    // `exp` is whole seconds, so it lands within a second below expiresAt.
    const payload = decodeToken(token)!;
    expect(payload.exp * 1000).toBeLessThanOrEqual(expiresAtMs);
    expect(payload.exp * 1000).toBeGreaterThan(expiresAtMs - 1000);
  });
});

describe("decodeToken", () => {
  it("accepts a fresh token", () => {
    const { token } = issueToken(USER);
    expect(decodeToken(token)).toMatchObject({ userId: 7, role: "CITIZEN" });
  });

  it("rejects the token once its expiry passes — there is no refresh", () => {
    const { token, expiresAt } = issueToken(USER);
    expect(decodeToken(token)).not.toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.parse(expiresAt) + 1000));
    expect(decodeToken(token)).toBeNull();
  });

  it("rejects a token that carries no expiry at all", () => {
    const eternal = "mock-token." + btoa(JSON.stringify({ userId: 7, role: "CITIZEN" }));
    expect(decodeToken(eternal)).toBeNull();
  });

  it("rejects a malformed or foreign token", () => {
    expect(decodeToken("not-a-mock-token")).toBeNull();
    expect(decodeToken("mock-token.@@@")).toBeNull();
  });
});
