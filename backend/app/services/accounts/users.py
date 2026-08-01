"""User management: the admin CRUD, plus self-service profile edits."""

from __future__ import annotations

from typing import Any

from app.domain.enums import UserRole
from app.models import User

# Sentinel that means "caller did not include this field at all."
# Distinct from ``None``, which means "caller explicitly set it to null."
_UNSET: Any = object()


def update_own_profile(
    *,
    user: User,
    caller_role: UserRole,
    full_name: str | None = _UNSET,
    display_name: str | None = _UNSET,
    email: str | None = _UNSET,
    zone_id: str | None = _UNSET,
) -> User:
    """PATCH /users/me — self-service profile edit.

    Business rules enforced here, not in the route:
      * 403 if a non-citizen tries to change their own zone.
      * 409 if the new email is already taken.
      * 400 if zone_id doesn't exist.
      * Explicit ``None`` for display_name clears it (vs. _UNSET = not sent).
    """
    from app.extensions import db
    from app.models import Zone
    from app.domain.errors import ConflictError, ForbiddenError, ValidationError

    if full_name is not _UNSET and full_name is not None:
        user.full_name = full_name

    if display_name is not _UNSET:
        # None → clear back to auto-generated placeholder; str → set it.
        user.display_name = display_name

    if email is not _UNSET and email is not None:
        normalised = email.strip().lower()
        if normalised != user.email:
            existing = db.session.scalar(
                db.select(User).filter_by(email=normalised)
            )
            if existing:
                raise ConflictError(
                    "EMAIL_TAKEN", "This email is already registered."
                )
            user.email = normalised

    if zone_id is not _UNSET and zone_id is not None:
        # 403: non-citizen cannot change their own zone.
        if caller_role != UserRole.CITIZEN:
            raise ForbiddenError(
                "Only citizens can change their own zone. "
                "Officer zone assignment is managed by an admin."
            )
        try:
            zid = int(zone_id)
        except (TypeError, ValueError) as exc:
            raise ValidationError(
                "zoneId must be a valid zone identifier."
            ) from exc
        zone = db.session.get(Zone, zid)
        if zone is None:
            raise ValidationError("Zone not found.")
        user.zone_id = zid

    db.session.commit()
    return user


def create_user(
    *,
    full_name: str,
    email: str,
    password: str,
    role: UserRole,
    zone_id: int | None,
) -> User:
    """POST /admin/users. TODO(phase 7).

    Creates a CITIZEN or an OFFICER — never an ADMIN. An officer MUST have a
    zone: "exactly one zone" is not a soft rule, and an officer with a null
    zone can see nothing at all.
    """
    raise NotImplementedError


def deactivate_user(*, user_id: int) -> User:
    """PATCH /admin/users/{id} with isActive=false. TODO(phase 7).

    The recommended path for removing someone. Takes effect IMMEDIATELY —
    which works only because every request re-loads the user row and re-checks
    ``is_active`` rather than trusting the token.

    A deactivated citizen drops off the leaderboard while keeping every
    points_ledger row, so reactivating restores their exact standing.
    Deactivation is a moderation tool, not a data deletion.
    """
    raise NotImplementedError


def delete_user(*, user_id: int) -> None:
    """DELETE /admin/users/{id}. TODO(phase 7). Exists to clean up mistakes.

    The schema protects the audit trails with ON DELETE RESTRICT, so a bare
    DELETE raises IntegrityError and surfaces as a 500. Count the blockers
    explicitly first and answer 409 with a message naming them:

      * complaints filed
      * points_ledger rows
      * progress notes authored
      * evidence reviews performed
      * status_history entries

    Recommend deactivation in the message. That is the documented path.
    """
    raise NotImplementedError


def reassign_officer_zone(*, officer_id: int, zone_id: int) -> User:
    """POST /admin/zones/{zoneId}/assign-officer. TODO(phase 7).

    Two effects, and the second is easy to miss: clear ``assigned_officer_id`` on
    every one of that officer's NON-TERMINAL complaints. Officer visibility is
    zone-scoped and evaluated per request, so leaving them assigned would leave
    complaints owned by someone who now gets a 403 opening them.
    """
    raise NotImplementedError
