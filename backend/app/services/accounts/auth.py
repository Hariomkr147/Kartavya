"""Registration, login, password changes.

Officers are created by admins, never self-registered — ``POST /auth/register``
always produces a CITIZEN, whatever the body says. Admins are seeded directly
into the database and there is deliberately no API that creates one.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime

from werkzeug.security import check_password_hash, generate_password_hash

from app.domain.credentials import has_usable_password, unusable_password_marker
from app.domain.enums import MfaMethodType
from app.domain.errors import AuthError
from app.models import User

# A pre-hashed dummy used by ``authenticate`` so that a lookup miss still runs
# the same scrypt work as a lookup hit. Without this, the response-time delta
# reveals whether an email is registered.
_DUMMY_HASH = generate_password_hash("timing-equalizer-not-a-real-password")


def hash_password(raw: str) -> str:
    """Werkzeug's scrypt. No extra dependency, and not a hand-rolled hash."""
    return generate_password_hash(raw)


def verify_password(user: User, raw: str) -> bool:
    if not has_usable_password(user.password_hash):
        # A Google-only account. Werkzeug would reject the marker instantly, and
        # that speed alone would tell a caller "this email exists and has no
        # password". Spend the same scrypt work as a real check instead.
        check_password_hash(_DUMMY_HASH, raw)
        return False
    return check_password_hash(user.password_hash, raw)


def register_citizen(
    *,
    full_name: str,
    email: str,
    password: str,
    zone_id: int | str,
    display_name: str | None,
    now: datetime,
) -> User:
    """POST /auth/register — public.

    Validates zone existence before inserting, so a stale zone list on the
    client produces a clean 400 instead of a 500 FK violation.
    """
    from app.domain.enums import UserRole
    from app.domain.errors import ConflictError, ValidationError
    from app.extensions import db
    from app.models import Zone

    email = email.strip().lower()

    # str → int conversion (the contract sends zoneId as a string).
    try:
        zone_id = int(zone_id)
    except (TypeError, ValueError) as exc:
        raise ValidationError("zoneId must be a valid zone identifier.") from exc

    # Zone existence — fail before INSERT, not on FK violation.
    zone = db.session.get(Zone, zone_id)
    if zone is None:
        raise ValidationError("Zone not found.")

    existing = db.session.scalar(db.select(User).filter_by(email=email))
    if existing:
        raise ConflictError("EMAIL_TAKEN", "This email is already registered.")

    user = User(
        full_name=full_name,
        email=email,
        password_hash=hash_password(password),
        role=UserRole.CITIZEN,
        zone_id=zone_id,
        display_name=display_name,
        created_at=now,
    )
    db.session.add(user)
    db.session.commit()
    return user


def authenticate(*, email: str, password: str) -> User:
    """POST /auth/login — any role.

    Returns the same error for unknown-email, wrong-password, and deactivated
    so that an attacker cannot probe which emails exist.  A dummy hash-check
    equalises timing between the miss and hit paths.
    """
    from app.domain.errors import AuthError
    from app.extensions import db

    email = email.strip().lower()

    user = db.session.scalar(db.select(User).filter_by(email=email))
    if user is None:
        # Spend the same time as a real password check.
        check_password_hash(_DUMMY_HASH, password)
        raise AuthError("Invalid email or password.")
    if not user.is_active or not verify_password(user, password):
        raise AuthError("Invalid email or password.")
    return user


def change_password(*, user: User, current_password: str, new_password: str) -> None:
    """POST /users/me/change-password — any authenticated role."""
    from app.domain.errors import AuthError
    from app.extensions import db

    if not verify_password(user, current_password):
        raise AuthError("Incorrect current password.")

    user.password_hash = hash_password(new_password)
    db.session.commit()


# --- The one funnel after ANY first login step --------------------------------
#
# Password login and Google sign-in both end here, the same way every status
# change ends in `apply_transition()`: no login path can skip the second step,
# because there is only one place a session is minted from a login.


@dataclass(frozen=True)
class SessionGrant:
    """A logged-in session: the caller serializes it as `AuthResponse`."""

    user: User
    token: str
    expires_at: datetime


@dataclass(frozen=True)
class MfaChallengeGrant:
    """The first step passed but two-step verification is on: `MfaChallenge`."""

    ticket: str
    method: MfaMethodType
    expires_at: datetime


def grant_session(user: User) -> SessionGrant:
    from app.core.auth import issue_token

    token, expires_at = issue_token(user)
    return SessionGrant(user=user, token=token, expires_at=expires_at)


def complete_primary_auth(user: User, now: datetime) -> SessionGrant | MfaChallengeGrant:
    """Turn a successful first login step into a session, or into a challenge.

    `user.mfa_method is None` covers every existing account and everyone who has
    not turned two-step verification on, so for them this returns exactly what
    login returned before.
    """
    if user.mfa_method is None:
        return grant_session(user)

    from app.core.auth import issue_mfa_ticket
    from app.services.accounts.mfa import service as mfa

    mfa.prepare_challenge(user, now)
    ticket, expires_at = issue_mfa_ticket(user)
    return MfaChallengeGrant(ticket=ticket, method=user.mfa_method, expires_at=expires_at)


# --- Google Sign-In -----------------------------------------------------------
#
# Google proves WHO someone is; Kartavya still issues its own session and the
# second step still applies, because every path below ends in
# `complete_primary_auth()`.


def _by_google_sub(sub: str) -> User | None:
    from app.extensions import db

    return db.session.scalar(db.select(User).filter_by(google_sub=sub))


def _by_email(email: str) -> User | None:
    from app.extensions import db

    return db.session.scalar(db.select(User).filter_by(email=email))


def _display_name_from(identity) -> str:
    """`full_name` is NOT NULL and capped at 120: Google's name, else the email's local part."""
    name = identity.name or identity.email.split("@", 1)[0]
    return name[:120] or "Citizen"


def sign_in_with_google(
    *, identity, zone_id: str | int | None, now: datetime, _retried: bool = False
) -> tuple[SessionGrant | MfaChallengeGrant, bool]:
    """POST /auth/google. Returns (grant, created).

    - `google_sub` already linked        -> log in.
    - email is a CITIZEN, no link yet    -> link and log in. Google proved the address.
    - email is an officer or admin       -> 403 GOOGLE_LINK_REQUIRED. Staff emails are
      typed in by an admin; a typo pointing at a stranger's Gmail must not hand that
      stranger the account. Staff log in with their password and link from
      their account page.
    - new email                          -> create a citizen (needs `zone_id`).
    """
    from sqlalchemy.exc import IntegrityError

    from app.domain.enums import UserRole
    from app.domain.errors import ConflictError, ForbiddenError, ValidationError
    from app.extensions import db
    from app.models import Zone

    created = False
    user = _by_google_sub(identity.sub)

    if user is None:
        user = _by_email(identity.email)
        if user is not None:
            if not user.is_active:
                raise AuthError("Your account is no longer active.")
            if user.role != UserRole.CITIZEN:
                raise ForbiddenError(
                    "Log in with your password, then link Google from your account page.",
                    code="GOOGLE_LINK_REQUIRED",
                )
            if user.google_sub is not None:
                raise ConflictError(
                    "GOOGLE_ALREADY_LINKED",
                    "This account is linked to a different Google account.",
                )
            user.google_sub = identity.sub
        else:
            if zone_id is None:
                raise ConflictError("ZONE_REQUIRED", "Choose your home zone to finish signing up.")
            try:
                zone = db.session.get(Zone, int(zone_id))
            except (TypeError, ValueError) as exc:
                raise ValidationError("zoneId must be a valid zone identifier.") from exc
            if zone is None:
                raise ValidationError("Zone not found.")
            user = User(
                full_name=_display_name_from(identity),
                email=identity.email,
                password_hash=unusable_password_marker(secrets.token_urlsafe(32)),
                role=UserRole.CITIZEN,
                zone_id=zone.id,
                google_sub=identity.sub,
                created_at=now,
            )
            db.session.add(user)
            created = True
        try:
            db.session.commit()
        except IntegrityError:
            # Two sign-ins for the same person raced. The other one won; read its row.
            db.session.rollback()
            if _retried:
                raise
            return sign_in_with_google(identity=identity, zone_id=zone_id, now=now, _retried=True)

    if not user.is_active:
        raise AuthError("Your account is no longer active.")
    return complete_primary_auth(user, now), created


def link_google(user: User, identity) -> User:
    """POST /users/me/google — any logged-in user, staff included."""
    from sqlalchemy.exc import IntegrityError

    from app.domain.errors import ConflictError
    from app.extensions import db

    if user.google_sub is not None:
        raise ConflictError("GOOGLE_ALREADY_LINKED", "A Google account is already linked.")
    other = _by_google_sub(identity.sub)
    if other is not None and other.id != user.id:
        raise ConflictError(
            "GOOGLE_ALREADY_LINKED", "That Google account is already linked to another user."
        )
    user.google_sub = identity.sub
    try:
        db.session.commit()
    except IntegrityError as exc:
        db.session.rollback()
        raise ConflictError(
            "GOOGLE_ALREADY_LINKED", "That Google account is already linked to another user."
        ) from exc
    return user


def unlink_google(user: User) -> None:
    """DELETE /users/me/google — only if there is another way to log in."""
    from app.domain.errors import ConflictError
    from app.extensions import db

    if user.google_sub is None:
        raise ConflictError("GOOGLE_NOT_LINKED", "No Google account is linked.")
    if not has_usable_password(user.password_hash):
        raise ConflictError(
            "NO_OTHER_LOGIN",
            "Google is the only way you can log in, so it cannot be unlinked.",
        )
    user.google_sub = None
    db.session.commit()
