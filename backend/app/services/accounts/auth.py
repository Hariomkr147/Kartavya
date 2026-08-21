"""Registration, login, password changes.

Officers are created by admins, never self-registered — ``POST /auth/register``
always produces a CITIZEN, whatever the body says. Admins are seeded directly
into the database and there is deliberately no API that creates one.
"""

from __future__ import annotations

from datetime import datetime

from werkzeug.security import check_password_hash, generate_password_hash

from app.models import User

# A pre-hashed dummy used by ``authenticate`` so that a lookup miss still runs
# the same scrypt work as a lookup hit. Without this, the response-time delta
# reveals whether an email is registered.
_DUMMY_HASH = generate_password_hash("timing-equalizer-not-a-real-password")


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
