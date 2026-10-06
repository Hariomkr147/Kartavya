"""Google sign-in rules at the service layer, one per role and state."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.core.google import GoogleIdentity
from app.domain.credentials import has_usable_password
from app.domain.enums import MfaMethodType, UserRole
from app.domain.errors import AuthError, ConflictError, ForbiddenError, ValidationError
from app.extensions import db
from app.models import User, Zone
from app.services.accounts import auth
from tests.mfa_support import enable_totp, make_user

NOW = datetime(2026, 9, 29, 12, 0, tzinfo=UTC)


def ident(sub="g-1", email="asha@example.com", name="Asha Verma"):
    return GoogleIdentity(sub=sub, email=email, name=name)


@pytest.fixture
def zone(app):
    z = Zone(zone_code="Z1", zone_name="One", center_lat=1.0, center_lng=1.0)
    db.session.add(z)
    db.session.commit()
    return z


def test_new_email_creates_a_citizen_with_no_password(zone):
    grant, created = auth.sign_in_with_google(identity=ident(), zone_id=str(zone.id), now=NOW)
    assert created is True and isinstance(grant, auth.SessionGrant)
    user = grant.user
    assert user.role == UserRole.CITIZEN and user.zone_id == zone.id
    assert user.google_sub == "g-1" and user.full_name == "Asha Verma"
    assert user.display_name is None
    assert not has_usable_password(user.password_hash)
    assert user.password_hash != "!"  # marker plus random text, not a constant


def test_new_email_without_a_zone_asks_for_one_and_creates_nothing(app):
    with pytest.raises(ConflictError) as exc:
        auth.sign_in_with_google(identity=ident(), zone_id=None, now=NOW)
    assert exc.value.code == "ZONE_REQUIRED"
    assert db.session.scalar(db.select(db.func.count()).select_from(User)) == 0


def test_bad_zone_is_a_400_and_creates_nothing(app):
    for bad in ("999", "abc"):
        with pytest.raises(ValidationError):
            auth.sign_in_with_google(identity=ident(), zone_id=bad, now=NOW)
    assert db.session.scalar(db.select(db.func.count()).select_from(User)) == 0


def test_a_name_missing_from_the_token_falls_back_to_the_email(zone):
    grant, _ = auth.sign_in_with_google(
        identity=ident(name=None, email="riya.k@example.com"), zone_id=str(zone.id), now=NOW
    )
    assert grant.user.full_name == "riya.k"


def test_returning_user_logs_in_by_google_id_even_if_their_email_changed(zone):
    auth.sign_in_with_google(identity=ident(), zone_id=str(zone.id), now=NOW)
    grant, created = auth.sign_in_with_google(
        identity=ident(email="new-address@example.com"), zone_id=None, now=NOW
    )
    assert created is False and grant.user.email == "asha@example.com"


def test_existing_citizen_is_linked_by_email(app):
    citizen = make_user()
    grant, created = auth.sign_in_with_google(identity=ident(), zone_id=None, now=NOW)
    assert created is False and grant.user.id == citizen.id
    assert citizen.google_sub == "g-1"
    assert has_usable_password(citizen.password_hash)  # their password still works


@pytest.mark.parametrize("role", [UserRole.OFFICER, UserRole.ADMIN])
def test_staff_are_never_linked_by_email(app, role):
    staff = make_user(role=role)
    with pytest.raises(ForbiddenError) as exc:
        auth.sign_in_with_google(identity=ident(), zone_id=None, now=NOW)
    assert exc.value.code == "GOOGLE_LINK_REQUIRED"
    assert staff.google_sub is None  # nothing was written


def test_staff_who_linked_from_their_account_can_then_sign_in(app):
    staff = make_user(role=UserRole.OFFICER)
    auth.link_google(staff, ident())
    grant, created = auth.sign_in_with_google(identity=ident(), zone_id=None, now=NOW)
    assert grant.user.id == staff.id and created is False


def test_deactivated_accounts_are_refused_on_every_path(app):
    user = make_user(active=False)
    with pytest.raises(AuthError):
        auth.sign_in_with_google(identity=ident(), zone_id=None, now=NOW)  # by email
    user.is_active = True
    user.google_sub = "g-1"
    db.session.commit()
    user.is_active = False
    db.session.commit()
    with pytest.raises(AuthError):
        auth.sign_in_with_google(identity=ident(), zone_id=None, now=NOW)  # by sub


def test_a_citizen_already_linked_to_a_different_google_account_conflicts(app):
    citizen = make_user()
    citizen.google_sub = "someone-else"
    db.session.commit()
    with pytest.raises(ConflictError) as exc:
        auth.sign_in_with_google(identity=ident(sub="g-1"), zone_id=None, now=NOW)
    assert exc.value.code == "GOOGLE_ALREADY_LINKED"


def test_google_still_goes_through_the_second_step(app):
    citizen = make_user()
    enable_totp(citizen, NOW)
    grant, _ = auth.sign_in_with_google(identity=ident(), zone_id=None, now=NOW)
    assert isinstance(grant, auth.MfaChallengeGrant)
    assert grant.method is MfaMethodType.TOTP


# --- Password login against a Google-only account ----------------------------


def test_google_only_accounts_cannot_password_login_and_answer_like_a_wrong_password(zone):
    grant, _ = auth.sign_in_with_google(identity=ident(), zone_id=str(zone.id), now=NOW)
    with pytest.raises(AuthError) as gone:
        auth.authenticate(email="nobody@example.com", password="whatever123")
    with pytest.raises(AuthError) as marker:
        auth.authenticate(email=grant.user.email, password="whatever123")
    assert marker.value.message == gone.value.message  # indistinguishable
    assert marker.value.code == gone.value.code


def test_the_marker_takes_as_long_as_a_real_check(zone, monkeypatch):
    """A fast rejection would reveal 'this email exists and has no password'."""
    calls = []
    real = auth.check_password_hash
    monkeypatch.setattr(auth, "check_password_hash", lambda h, p: calls.append(h) or real(h, p))
    grant, _ = auth.sign_in_with_google(identity=ident(), zone_id=str(zone.id), now=NOW)
    with pytest.raises(AuthError):
        auth.authenticate(email=grant.user.email, password="whatever123")
    assert calls == [auth._DUMMY_HASH]  # the dummy hash ran: same scrypt work


def test_change_password_on_a_google_only_account_is_refused(zone):
    grant, _ = auth.sign_in_with_google(identity=ident(), zone_id=str(zone.id), now=NOW)
    with pytest.raises(AuthError):
        auth.change_password(user=grant.user, current_password="x" * 12, new_password="y" * 12)


# --- Link / unlink -----------------------------------------------------------


def test_link_and_unlink_round_trip(app):
    user = make_user()
    auth.link_google(user, ident())
    assert user.google_sub == "g-1"
    auth.unlink_google(user)
    assert user.google_sub is None


def test_link_conflicts(app):
    a, b = make_user(), make_user(email="b@example.com")
    auth.link_google(a, ident(sub="g-1"))
    with pytest.raises(ConflictError) as exc:
        auth.link_google(b, ident(sub="g-1"))  # already belongs to a
    assert exc.value.code == "GOOGLE_ALREADY_LINKED"
    with pytest.raises(ConflictError):
        auth.link_google(a, ident(sub="g-2"))  # a already has one
    assert b.google_sub is None


def test_unlink_guards(zone):
    plain = make_user()
    with pytest.raises(ConflictError) as exc:
        auth.unlink_google(plain)
    assert exc.value.code == "GOOGLE_NOT_LINKED"

    grant, _ = auth.sign_in_with_google(
        identity=ident(sub="g-2", email="google-only@example.com"), zone_id=str(zone.id), now=NOW
    )
    with pytest.raises(ConflictError) as exc:
        auth.unlink_google(grant.user)  # Google is their only way in
    assert exc.value.code == "NO_OTHER_LOGIN"
    assert grant.user.google_sub == "g-2"
