"""Two-step verification: setup, confirm, verify at login, disable, admin reset.

Everything a method should not have to re-implement lives here once:

- the encrypted state round trip (`app/core/secretbox.py`),
- the wrong-code counter and the 15-minute lockout,
- the *guarded write*: `UPDATE users SET ... WHERE id = :id AND mfa_secret_enc =
  :the_blob_we_read`. `rowcount` decides, exactly like `apply_transition()` —
  two requests racing with the same code cannot both succeed, and a burst of
  parallel wrong guesses cannot dodge the counter by losing each other's writes.

The states a user can be in (no separate "enabled" flag):

    mfa_method NULL, mfa_secret_enc NULL   two-step verification off
    mfa_method NULL, mfa_secret_enc set    setup started, first code not confirmed
                                           (login ignores it)
    mfa_method set,  mfa_secret_enc set    on
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import update

from app.core import secretbox
from app.domain.enums import MfaMethodType
from app.domain.errors import (
    AuthError,
    ConflictError,
    DomainError,
    NotFoundError,
    TooManyRequestsError,
    ValidationError,
)
from app.extensions import db
from app.models import User
from app.services.accounts.mfa.base import SetupPrompt
from app.services.accounts.mfa.registry import METHODS

MAX_FAILURES = 5
LOCKOUT = timedelta(minutes=15)
#: Attempts to land one guarded write before giving up. A write only loses to a
#: concurrent write on the SAME user, so this is only ever exercised by a burst.
_MAX_RETRIES = 5


def _wrong_code_at_login() -> DomainError:
    return AuthError("That code is not right.", code="INVALID_CODE")


def _wrong_code_in_session() -> DomainError:
    # 400, not 401: the session is fine, the code is what is wrong.
    return ValidationError("That code is not right.", code="INVALID_CODE")


def _locked_until(state: dict[str, Any]) -> datetime | None:
    raw = state.get("locked_until")
    return datetime.fromisoformat(raw) if raw else None


def _locked_error(until: datetime, now: datetime) -> TooManyRequestsError:
    minutes = max(1, int((until - now).total_seconds() // 60) + 1)
    return TooManyRequestsError(
        f"Too many wrong codes. Try again in {minutes} minute{'s' if minutes != 1 else ''}.",
        code="MFA_LOCKED",
    )


def _guarded_update(user_id: int, old_blob: str, values: dict[str, Any]) -> bool:
    """Write `values` only if the encrypted state is still what we read. True if it landed."""
    result = db.session.execute(
        update(User)
        .where(User.id == user_id, User.mfa_secret_enc == old_blob)
        .values(**values)
        .execution_options(synchronize_session="fetch")
    )
    return result.rowcount == 1


def _verify(
    user: User,
    code: str,
    now: datetime,
    *,
    wrong: Callable[[], DomainError],
    on_success: Callable[[dict[str, Any]], dict[str, Any]],
    method: MfaMethodType | None = None,
) -> None:
    """Check `code` against the user's stored state and record the outcome.

    Returns on a right code (after `on_success`'s column values were written and
    committed). On a wrong code it records the failure FIRST, commits, then
    raises — the counter must survive the exception.
    """
    for _ in range(_MAX_RETRIES):
        db.session.refresh(user)
        blob = user.mfa_secret_enc
        if blob is None:
            raise wrong()
        state = secretbox.unseal(blob)

        until = _locked_until(state)
        if until is not None and now < until:
            raise _locked_error(until, now)

        impl = METHODS[method or user.mfa_method or MfaMethodType(state["method"])]
        ok, after = impl.check(state, code, now)

        just_locked: datetime | None = None
        if ok:
            after = {**after, "failed": 0, "locked_until": None}
            values = on_success(after)
        else:
            failed = int(state.get("failed", 0)) + 1
            after = {**state, "failed": failed, "locked_until": None}
            if failed >= MAX_FAILURES:
                just_locked = now + LOCKOUT
                after.update(failed=0, locked_until=just_locked.isoformat())
            values = {"mfa_secret_enc": secretbox.seal(after)}

        if _guarded_update(user.id, blob, values):
            db.session.commit()
            db.session.refresh(user)
            if ok:
                return
            if just_locked is not None:
                raise _locked_error(just_locked, now)
            raise wrong()
        db.session.rollback()  # lost a race on this row: re-read and go again

    # Could not record the outcome. Refusing is the only safe answer — accepting
    # an unrecorded success would let a replay through; an unrecorded failure
    # would let a burst dodge the lockout.
    raise TooManyRequestsError("Too many attempts at once. Try again in a moment.", code="MFA_BUSY")


def start_setup(user: User, method: MfaMethodType, now: datetime) -> SetupPrompt:
    """Begin enrolling. Stores a PENDING state; two-step verification is not on yet."""
    secretbox.require_configured()
    if user.mfa_method is not None:
        raise ConflictError(
            "MFA_ALREADY_ENABLED", "Two-step verification is already on. Turn it off first."
        )
    state, prompt = METHODS[method].begin_setup(user, now)
    state = {**state, "method": method.value, "failed": 0, "locked_until": None}
    user.mfa_secret_enc = secretbox.seal(state)
    db.session.commit()
    return prompt


def confirm_setup(user: User, code: str, now: datetime) -> User:
    """The first right code turns two-step verification on."""
    if user.mfa_method is not None:
        raise ConflictError("MFA_ALREADY_ENABLED", "Two-step verification is already on.")
    if user.mfa_secret_enc is None:
        raise ConflictError("NO_PENDING_SETUP", "Start setting up two-step verification first.")
    method = MfaMethodType(secretbox.unseal(user.mfa_secret_enc)["method"])
    _verify(
        user,
        code,
        now,
        method=method,
        wrong=_wrong_code_in_session,
        on_success=lambda st: {"mfa_method": method, "mfa_secret_enc": secretbox.seal(st)},
    )
    return user


def disable(user: User, code: str, now: datetime) -> None:
    """Turn it off. Needs a current code, so a stolen session alone cannot do it."""
    if user.mfa_method is None:
        raise ConflictError("MFA_NOT_ENABLED", "Two-step verification is not on.")
    _verify(
        user,
        code,
        now,
        wrong=_wrong_code_in_session,
        on_success=lambda st: {"mfa_method": None, "mfa_secret_enc": None},
    )


def prepare_challenge(user: User, now: datetime) -> None:
    """Called once the first login step succeeds and 2FA is on: let the method send a code.

    TOTP sends nothing and this writes nothing. A method that does send (email,
    SMS, WhatsApp) returns new state — a fresh code hash and expiry — which is
    stored with the same guarded write as everything else.
    """
    assert user.mfa_method is not None and user.mfa_secret_enc is not None
    blob = user.mfa_secret_enc
    state = secretbox.unseal(blob)
    new_state = METHODS[user.mfa_method].send_code(state, now)
    if new_state != state:
        _guarded_update(user.id, blob, {"mfa_secret_enc": secretbox.seal(new_state)})
        db.session.commit()


def complete_login(user_id: int, code: str, now: datetime) -> User:
    """Second step of a login: the ticket named `user_id`, `code` is what they typed."""
    user = db.session.get(User, user_id)
    if user is None or not user.is_active:
        # Same answer for both, as everywhere else in auth.
        raise AuthError("Your account is no longer active.")
    if user.mfa_method is None:
        raise AuthError("Invalid or expired sign-in session. Please log in again.")
    _verify(
        user,
        code,
        now,
        wrong=_wrong_code_at_login,
        on_success=lambda st: {"mfa_secret_enc": secretbox.seal(st)},
    )
    return user


def reset(user: User) -> None:
    """Clear two-step verification for a user (admin reset, or the server CLI).

    Needs no key and no code — the whole point is recovering an account whose
    device or key is gone. Also clears a half-finished setup.
    """
    user.mfa_method = None
    user.mfa_secret_enc = None
    db.session.commit()


def admin_reset(user_id: int) -> None:
    user = db.session.get(User, user_id)
    if user is None:
        raise NotFoundError("No such user.")
    reset(user)
