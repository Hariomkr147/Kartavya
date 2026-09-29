"""Two-step verification at the service layer: setup, verify, lockout, races, reset.

`now` is passed in everywhere, so time (30-second steps, the 15-minute lockout)
is fully under the test's control.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import update

from app.core import secretbox
from app.domain.enums import MfaMethodType
from app.domain.errors import (
    AuthError,
    ConflictError,
    NotFoundError,
    ServiceUnavailableError,
    TooManyRequestsError,
    ValidationError,
)
from app.extensions import db
from app.models import User
from app.services.accounts import auth
from app.services.accounts.mfa import service as mfa
from app.services.accounts.mfa.registry import METHODS
from tests.mfa_support import code_at, enable_totp, make_user, wrong_code

NOW = datetime(2026, 9, 29, 12, 0, 0, tzinfo=UTC)


def _state(user):
    return secretbox.unseal(user.mfa_secret_enc)


# --- Setup -------------------------------------------------------------------


def test_setup_is_pending_until_the_first_code_is_confirmed(app):
    user = make_user()
    prompt = mfa.start_setup(user, MfaMethodType.TOTP, NOW)

    assert user.mfa_method is None  # not on yet
    assert user.mfa_secret_enc is not None  # but a secret is waiting
    assert prompt.secret not in user.mfa_secret_enc  # encrypted at rest
    assert prompt.otpauth_uri.startswith("otpauth://totp/Kartavya:asha%40example.com?secret=")
    # Login ignores a pending setup entirely.
    assert isinstance(auth.complete_primary_auth(user, NOW), auth.SessionGrant)


def test_confirm_with_the_right_code_turns_it_on(app):
    user = make_user()
    prompt = mfa.start_setup(user, MfaMethodType.TOTP, NOW)
    mfa.confirm_setup(user, code_at(prompt.secret, NOW), NOW)
    assert user.mfa_method is MfaMethodType.TOTP
    assert isinstance(auth.complete_primary_auth(user, NOW), auth.MfaChallengeGrant)


def test_confirm_with_a_wrong_code_leaves_setup_pending(app):
    user = make_user()
    prompt = mfa.start_setup(user, MfaMethodType.TOTP, NOW)
    with pytest.raises(ValidationError) as exc:
        mfa.confirm_setup(user, wrong_code(prompt.secret, NOW), NOW)
    assert exc.value.code == "INVALID_CODE"
    assert exc.value.http_status == 400  # the session is fine; only the code is wrong
    assert user.mfa_method is None
    assert _state(user)["failed"] == 1  # and the failure was recorded despite the exception


def test_restarting_setup_replaces_the_pending_secret(app):
    user = make_user()
    first = mfa.start_setup(user, MfaMethodType.TOTP, NOW).secret
    second = mfa.start_setup(user, MfaMethodType.TOTP, NOW).secret
    assert first != second
    with pytest.raises(ValidationError):
        mfa.confirm_setup(user, code_at(first, NOW), NOW)  # the old secret is dead


def test_setup_and_confirm_state_errors(app):
    user = make_user()
    with pytest.raises(ConflictError) as exc:
        mfa.confirm_setup(user, "123456", NOW)
    assert exc.value.code == "NO_PENDING_SETUP"

    enable_totp(user, NOW)
    with pytest.raises(ConflictError) as exc:
        mfa.start_setup(user, MfaMethodType.TOTP, NOW)
    assert exc.value.code == "MFA_ALREADY_ENABLED"


def test_setup_is_503_when_the_server_has_no_key(app):
    app.config["MFA_ENCRYPTION_KEY"] = ""
    user = make_user()
    with pytest.raises(ServiceUnavailableError) as exc:
        mfa.start_setup(user, MfaMethodType.TOTP, NOW)
    assert exc.value.code == "MFA_NOT_CONFIGURED"
    assert user.mfa_secret_enc is None


# --- Verifying at login ------------------------------------------------------


def test_login_code_is_accepted_once_and_never_replayed(app):
    user = make_user()
    secret = enable_totp(user, NOW)  # consumed the step at NOW

    later = NOW + timedelta(seconds=30)
    code = code_at(secret, later)
    assert mfa.complete_login(user.id, code, later).id == user.id
    with pytest.raises(AuthError) as exc:
        mfa.complete_login(user.id, code, later)  # the very same code again
    assert exc.value.code == "INVALID_CODE"


def test_a_code_from_the_step_already_used_at_setup_is_refused(app):
    user = make_user()
    secret = enable_totp(user, NOW)
    with pytest.raises(AuthError):
        mfa.complete_login(user.id, code_at(secret, NOW), NOW)


def test_a_code_one_step_ahead_is_fine_but_two_is_not(app):
    user = make_user()
    secret = enable_totp(user, NOW)
    with pytest.raises(AuthError):
        mfa.complete_login(user.id, code_at(secret, NOW, offset=2), NOW)
    assert mfa.complete_login(user.id, code_at(secret, NOW, offset=1), NOW)


def test_five_wrong_codes_lock_it_and_it_unlocks_after_fifteen_minutes(app):
    user = make_user()
    secret = enable_totp(user, NOW)
    t = NOW + timedelta(seconds=60)
    for _ in range(4):
        with pytest.raises(AuthError):
            mfa.complete_login(user.id, wrong_code(secret, t), t)
    with pytest.raises(TooManyRequestsError) as exc:  # the fifth one trips the lock
        mfa.complete_login(user.id, wrong_code(secret, t), t)
    assert exc.value.code == "MFA_LOCKED"
    assert exc.value.http_status == 429

    # While locked even the RIGHT code is refused, and does not extend the lock.
    with pytest.raises(TooManyRequestsError):
        mfa.complete_login(user.id, code_at(secret, t), t)
    still = t + timedelta(minutes=14, seconds=59)
    with pytest.raises(TooManyRequestsError):
        mfa.complete_login(user.id, code_at(secret, still), still)

    unlocked = t + timedelta(minutes=15, seconds=1)
    assert mfa.complete_login(user.id, code_at(secret, unlocked), unlocked)
    assert _state(user)["failed"] == 0


def test_a_right_code_resets_the_failure_counter(app):
    user = make_user()
    secret = enable_totp(user, NOW)
    t = NOW + timedelta(seconds=60)
    for _ in range(3):
        with pytest.raises(AuthError):
            mfa.complete_login(user.id, wrong_code(secret, t), t)
    assert _state(user)["failed"] == 3
    mfa.complete_login(user.id, code_at(secret, t), t)
    assert _state(user)["failed"] == 0


def test_login_step_refuses_deactivated_and_unenrolled_users(app):
    user = make_user()
    secret = enable_totp(user, NOW)
    user.is_active = False
    db.session.commit()
    with pytest.raises(AuthError):
        mfa.complete_login(user.id, code_at(secret, NOW, 1), NOW)

    other = make_user(email="b@example.com")  # two-step verification never turned on
    with pytest.raises(AuthError):
        mfa.complete_login(other.id, "123456", NOW)
    with pytest.raises(AuthError):
        mfa.complete_login(999_999, "123456", NOW)


def test_unreadable_state_is_a_503_that_an_admin_reset_clears(app):
    user = make_user()
    secret = enable_totp(user, NOW)
    app.config["MFA_ENCRYPTION_KEY"] = Fernet.generate_key().decode()  # key lost

    with pytest.raises(ServiceUnavailableError) as exc:
        mfa.complete_login(user.id, code_at(secret, NOW, 1), NOW)
    assert exc.value.code == "MFA_STATE_UNREADABLE"

    mfa.admin_reset(user.id)  # needs neither the key nor a code
    assert user.mfa_method is None and user.mfa_secret_enc is None
    assert isinstance(auth.complete_primary_auth(user, NOW), auth.SessionGrant)


# --- Races: the guarded write ------------------------------------------------


def test_guarded_update_loses_to_a_concurrent_write(app):
    user = make_user()
    enable_totp(user, NOW)
    stale = user.mfa_secret_enc

    db.session.execute(update(User).where(User.id == user.id).values(mfa_secret_enc="changed"))
    db.session.commit()

    assert mfa._guarded_update(user.id, stale, {"mfa_secret_enc": "mine"}) is False
    db.session.rollback()
    assert db.session.get(User, user.id).mfa_secret_enc == "changed"


def test_a_burst_that_cannot_record_its_outcome_is_refused_not_waved_through(app, monkeypatch):
    user = make_user()
    secret = enable_totp(user, NOW)
    monkeypatch.setattr(mfa, "_guarded_update", lambda *a, **k: False)  # always loses
    t = NOW + timedelta(seconds=60)
    with pytest.raises(TooManyRequestsError) as exc:
        mfa.complete_login(user.id, code_at(secret, t), t)  # even a RIGHT code
    assert exc.value.code == "MFA_BUSY"


def test_a_lost_race_is_retried_against_fresh_state(app, monkeypatch):
    user = make_user()
    secret = enable_totp(user, NOW)
    real = mfa._guarded_update
    calls = {"n": 0}

    def flaky(*args, **kwargs):
        calls["n"] += 1
        return False if calls["n"] == 1 else real(*args, **kwargs)

    monkeypatch.setattr(mfa, "_guarded_update", flaky)
    t = NOW + timedelta(seconds=60)
    assert mfa.complete_login(user.id, code_at(secret, t), t)
    assert calls["n"] == 2


# --- Disable and reset -------------------------------------------------------


def test_disable_needs_a_current_code(app):
    user = make_user()
    secret = enable_totp(user, NOW)
    t = NOW + timedelta(seconds=60)
    with pytest.raises(ValidationError):
        mfa.disable(user, wrong_code(secret, t), t)
    assert user.mfa_method is MfaMethodType.TOTP

    mfa.disable(user, code_at(secret, t), t)
    assert user.mfa_method is None and user.mfa_secret_enc is None

    with pytest.raises(ConflictError) as exc:
        mfa.disable(user, "123456", t)
    assert exc.value.code == "MFA_NOT_ENABLED"


def test_admin_reset_clears_active_and_pending_setups(app):
    active = make_user()
    enable_totp(active, NOW)
    pending = make_user(email="p@example.com")
    mfa.start_setup(pending, MfaMethodType.TOTP, NOW)

    for user in (active, pending):
        mfa.admin_reset(user.id)
        assert user.mfa_method is None and user.mfa_secret_enc is None
    mfa.admin_reset(active.id)  # idempotent
    with pytest.raises(NotFoundError):
        mfa.admin_reset(999_999)


# --- The extension point -----------------------------------------------------


class _EmailLikeMethod:
    """A sent-code method: makes a code at login and 'delivers' it. Proves the seam."""

    sent: list[str]

    def __init__(self):
        self.sent = []

    def begin_setup(self, user, now):  # pragma: no cover - not exercised here
        raise NotImplementedError

    def send_code(self, state, now):
        code = f"{len(self.sent) + 100000}"
        self.sent.append(code)
        return {**state, "code": code}

    def check(self, state, code, now):
        return (state.get("code") == code), state


def test_a_sent_code_method_rides_the_same_lockout_and_guarded_write(app, monkeypatch):
    fake = _EmailLikeMethod()
    monkeypatch.setitem(METHODS, MfaMethodType.TOTP, fake)  # stand in for a second method

    user = make_user()
    user.mfa_method = MfaMethodType.TOTP
    user.mfa_secret_enc = secretbox.seal({"method": "TOTP", "failed": 0, "locked_until": None})
    db.session.commit()

    # The funnel asks the method to deliver a code, and stores what it returns.
    grant = auth.complete_primary_auth(user, NOW)
    assert isinstance(grant, auth.MfaChallengeGrant)
    assert fake.sent == ["100000"]
    assert _state(user)["code"] == "100000"

    # Wrong codes count and lock exactly as for TOTP...
    for _ in range(4):
        with pytest.raises(AuthError):
            mfa.complete_login(user.id, "000000", NOW)
    with pytest.raises(TooManyRequestsError):
        mfa.complete_login(user.id, "000000", NOW)
    # ...and after the lockout the right code works.
    later = NOW + timedelta(minutes=16)
    assert mfa.complete_login(user.id, "100000", later).id == user.id
