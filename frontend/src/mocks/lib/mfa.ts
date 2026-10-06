/**
 * Code checking with the same rules as the backend's `mfa/service.py`:
 * five wrong codes lock it for 15 minutes, a right code resets the counter and
 * records its step (so it cannot be replayed), and a locked account refuses
 * even the right code. Shared by the login step and the account endpoints.
 */
import { persist } from "../db/store";
import type { UserRow } from "../db/types";
import { errorResponse } from "./http";
import { matchStep } from "./totp";

export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60_000;

function locked(until: string, now: number) {
  const minutes = Math.max(1, Math.ceil((Date.parse(until) - now) / 60_000));
  return errorResponse(
    429,
    "MFA_LOCKED",
    `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
  );
}

/** Returns null when `code` is right (state updated), otherwise the response to send. */
export async function checkCode(
  user: UserRow,
  code: string,
  wrong: () => Response,
  now = Date.now(),
): Promise<Response | null> {
  const state = user.mfa;
  if (!state) return wrong();

  if (state.lockedUntil && now < Date.parse(state.lockedUntil)) {
    return locked(state.lockedUntil, now);
  }

  const step = await matchStep(state.secret, code, now, state.lastStep);
  if (step !== null) {
    state.lastStep = step;
    state.failed = 0;
    state.lockedUntil = null;
    persist();
    return null;
  }

  state.failed += 1;
  if (state.failed >= MAX_FAILURES) {
    state.failed = 0;
    state.lockedUntil = new Date(now + LOCKOUT_MS).toISOString();
    persist();
    return locked(state.lockedUntil, now);
  }
  persist();
  return wrong();
}
