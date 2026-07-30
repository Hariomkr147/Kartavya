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
    """POST /auth/register — public."""
    from app.extensions import db
    from app.domain.errors import ConflictError
    from app.domain.enums import UserRole

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
        created_at=now
    )
    db.session.add(user)
    db.session.commit()
    return user


def authenticate(*, email: str, password: str) -> User:
    """POST /auth/login — any role."""
    from app.extensions import db
    from app.domain.errors import AuthError

    user = db.session.scalar(db.select(User).filter_by(email=email))
    if not user or not user.is_active or not verify_password(user, password):
        raise AuthError("Invalid email or password.")
    return user


def change_password(*, user: User, current_password: str, new_password: str) -> None:
    """POST /users/me/change-password — any authenticated role."""
    from app.extensions import db
    from app.domain.errors import AuthError

    if not verify_password(user, current_password):
        raise AuthError("Incorrect current password.")

    user.password_hash = hash_password(new_password)
    db.session.commit()
