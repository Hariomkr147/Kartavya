import type { MfaChallenge } from "@/types/api";

/**
 * Thrown by `login()` and `googleSignIn()` (AuthContext) when the first step
 * succeeded but the account has two-step verification on. Nothing is stored yet:
 * the ticket lives only in whatever component catches this (never localStorage),
 * and is spent at `verifyMfa()`. `login()` still resolves to a `User` for
 * everyone else, so existing callers are unaffected.
 *
 * Its own file, not AuthContext's, so that file keeps exporting only React
 * things (react-refresh needs that to hot-reload a context).
 */
export class MfaRequiredError extends Error {
  readonly ticket: string;
  readonly method: MfaChallenge["method"];
  readonly expiresAt: string;

  constructor(challenge: MfaChallenge) {
    super("Two-step verification is required.");
    this.name = "MfaRequiredError";
    this.ticket = challenge.mfaTicket;
    this.method = challenge.method;
    this.expiresAt = challenge.expiresAt;
  }
}
