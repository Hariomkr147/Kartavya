"""Registration, login, password changes.

Officers are created by admins, never self-registered — `POST /auth/register`
always produces a CITIZEN, whatever the body says. Admins are seeded directly
into the database and there is deliberately no API that creates one.
"""

from __future__ import annotations

from datetime import datetime

from werkzeug.security import check_password_hash, generate_password_hash

from app.models import User


def hash_password(raw: str) -> str:
    """Werkzeug's scrypt. No extra dependency, and not a hand-rolled hash."""
    return generate_password_hash(raw)


def verify_password(user: User, raw: str) -> bool:
    return check_password_hash(user.password_hash, raw)


def register_citizen(
    *,
    full_name: str,
    email: str,
    password: str,
    zone_id: int,
    display_name: str | None,
    now: datetime,
) -> User:
    """POST /auth/register — public.

    TODO(phase 2).
      * 409 EMAIL_TAKEN if the email exists in ANY role. That single uniqueness
        rule is what stops someone self-registering into an officer's address.
      * Role is forced to CITIZEN. `zone_id` is the citizen's home zone and is
        required by the registration form — which is why GET /zones is public.
      * Store only the hash.
    """
    raise NotImplementedError


def authenticate(*, email: str, password: str) -> User:
    """POST /auth/login — any role.

    TODO(phase 2). Answer 401 with the SAME message for "no such email", "wrong
    password" and "deactivated account". Distinguishing them turns the login
    form into an account-enumeration oracle.

    On success the route mints the token via `core.auth.issue_token` and returns
    AuthResponse{token, expiresAt, user}.
    """
    raise NotImplementedError


def change_password(*, user: User, current_password: str, new_password: str) -> None:
    """POST /users/me/change-password — any authenticated role.

    TODO(phase 2). Verify the current password before setting the new one, even
    though the caller is already authenticated: a walked-up-to unlocked laptop
    must not be enough to take an account over.

    There is no token revocation in this system — tokens are 24 h and there is
    no refresh — so a changed password does not invalidate outstanding tokens.
    Say so if it ever becomes a requirement.
    """
    raise NotImplementedError
