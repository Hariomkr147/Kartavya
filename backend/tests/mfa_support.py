"""Small helpers shared by the two-step-verification tests.

Codes are computed the way an authenticator app computes them, from the secret
the setup response returned — so no test needs a database back door to log in.
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.domain import totp
from app.domain.enums import MfaMethodType, UserRole
from app.extensions import db
from app.models import User
from app.services.accounts.auth import hash_password
from app.services.accounts.mfa import service as mfa

PASSWORD = "password123"


def code_at(secret: str, now: datetime, offset: int = 0) -> str:
    """The code an authenticator app shows at `now` (`offset` steps later or earlier)."""
    return totp.code_for_step(secret, totp.step_at(int(now.timestamp())) + offset)


def wrong_code(secret: str, now: datetime) -> str:
    """A well-formed code that is right for no step inside the window."""
    return code_at(secret, now, offset=10)


def utcnow() -> datetime:
    return datetime.now(UTC)


def make_user(
    *,
    email: str = "asha@example.com",
    role: UserRole = UserRole.CITIZEN,
    zone_id: int | None = None,
    active: bool = True,
) -> User:
    user = User(
        full_name="Asha Verma",
        email=email,
        password_hash=hash_password(PASSWORD),
        role=role,
        zone_id=zone_id,
        is_active=active,
    )
    db.session.add(user)
    db.session.commit()
    return user


def enable_totp(user: User, now: datetime) -> str:
    """Turn two-step verification on through the real service. Returns the secret."""
    prompt = mfa.start_setup(user, MfaMethodType.TOTP, now)
    mfa.confirm_setup(user, code_at(prompt.secret, now), now)
    return prompt.secret
