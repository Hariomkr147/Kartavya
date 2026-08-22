"""User management: the admin CRUD, plus self-service profile edits."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select, update

from app.core.session import transaction
from app.domain.enums import UserRole
from app.domain.errors import ConflictError, ErrorDetail, NotFoundError, ValidationError
from app.domain.lifecycle import TERMINAL
from app.extensions import db
from app.models import (
    Complaint,
    ComplaintEvidence,
    ComplaintNote,
    PointsLedger,
    StatusHistory,
    User,
    Zone,
)
from app.services.accounts.auth import hash_password
from app.services.queries import Pagination, apply_pagination

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
    from app.domain.errors import ConflictError, ForbiddenError, ValidationError
    from app.extensions import db
    from app.models import Zone

    if full_name is not _UNSET and full_name is not None:
        user.full_name = full_name

    if display_name is not _UNSET:
        # None → clear back to auto-generated placeholder; str → set it.
        user.display_name = display_name

    if email is not _UNSET and email is not None:
        normalised = email.strip().lower()
        if normalised != user.email:
            existing = db.session.scalar(db.select(User).filter_by(email=normalised))
            if existing:
                raise ConflictError("EMAIL_TAKEN", "This email is already registered.")
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
            raise ValidationError("zoneId must be a valid zone identifier.") from exc
        zone = db.session.get(Zone, zid)
        if zone is None:
            raise ValidationError("Zone not found.")
        user.zone_id = zid

    db.session.commit()
    return user


def list_users(
    *, role: UserRole | None, zone_id: int | None, active: bool | None, page: int, page_size: int
) -> tuple[list[User], Pagination]:
    query = select(User)
    if role is not None:
        query = query.where(User.role == role)
    if zone_id is not None:
        query = query.where(User.zone_id == zone_id)
    if active is not None:
        query = query.where(User.is_active.is_(active))
    total = db.session.scalar(select(func.count()).select_from(query.subquery()))
    rows = list(db.session.scalars(apply_pagination(query.order_by(User.id), page, page_size)))
    return rows, Pagination(page, page_size, int(total or 0))


def get_user(*, user_id: int) -> User:
    user = db.session.get(User, user_id)
    if user is None:
        raise NotFoundError("No such user.")
    return user


def _valid_zone(zone_id: int | None) -> bool:
    return zone_id is not None and db.session.get(Zone, zone_id) is not None


def create_user(
    *, full_name: str, email: str, password: str, role: UserRole, zone_id: int | None
) -> User:
    if role is UserRole.ADMIN:
        raise ValidationError("Admins cannot be created through this API.")
    if role is UserRole.OFFICER and not _valid_zone(zone_id):
        raise ValidationError("An OFFICER requires exactly one valid zoneId.")
    if zone_id is not None and not _valid_zone(zone_id):
        raise ValidationError("zoneId does not refer to a known zone.")
    normalized_email = email.strip().lower()
    if db.session.scalar(select(User.id).where(func.lower(User.email) == normalized_email)):
        raise ConflictError("EMAIL_TAKEN", "An account with this email already exists.")
    with transaction():
        user = User(
            full_name=full_name.strip(),
            email=normalized_email,
            password_hash=hash_password(password),
            role=role,
            zone_id=zone_id,
            is_active=True,
        )
        db.session.add(user)
        db.session.flush()
        return user


def _guard_last_admin(user: User, *, acting_admin_id: int, verb: str) -> None:
    """Refuse to strand the admin surface with no way back in.

    Two ways one request can do that, and both must be closed here rather than
    in the UI: an admin turning off their *own* account, and an admin turning
    off the only other active one. Either leaves zero active admins, and there
    is no route back — `create_user` refuses to mint an ADMIN, and a
    deactivated account cannot log in. The only recovery is editing the
    database by hand.

    Non-admin targets are never blocked, and deactivating one admin while
    another active admin remains is still allowed.
    """
    if user.role is not UserRole.ADMIN:
        return
    if user.id == acting_admin_id:
        raise ConflictError(
            "LAST_ADMIN",
            f"You cannot {verb} your own admin account — you would be locked out "
            "immediately, and admins cannot be created through this API.",
        )
    remaining = db.session.scalar(
        select(func.count(User.id)).where(
            User.role == UserRole.ADMIN,
            User.is_active.is_(True),
            User.id != user.id,
        )
    )
    if not remaining:
        raise ConflictError(
            "LAST_ADMIN",
            f"This is the only active admin account left — {verb} it and nobody "
            "can reach the admin surface again.",
        )


def update_user(
    *,
    user_id: int,
    acting_admin_id: int,
    full_name: str | None,
    email: str | None,
    zone_id: int | None,
    change_zone: bool,
    active: bool | None,
) -> User:
    with transaction():
        user = db.session.get(User, user_id)
        if user is None:
            raise NotFoundError("No such user.")
        if active is False:
            _guard_last_admin(user, acting_admin_id=acting_admin_id, verb="deactivate")
        if email is not None:
            normalized = email.strip().lower()
            duplicate = db.session.scalar(
                select(User.id).where(func.lower(User.email) == normalized, User.id != user.id)
            )
            if duplicate is not None:
                raise ConflictError("EMAIL_TAKEN", "The new email is already taken.")
            user.email = normalized
        if full_name is not None:
            user.full_name = full_name.strip()
        if active is not None:
            user.is_active = active
        if change_zone:
            if user.role is UserRole.ADMIN:
                raise ValidationError("An ADMIN cannot be assigned to a zone.")
            if not _valid_zone(zone_id):
                raise ValidationError("zoneId does not refer to a known zone.")
            if user.role is UserRole.OFFICER and user.zone_id != zone_id:
                _clear_old_assignments(user.id, user.zone_id)
            user.zone_id = zone_id
        return user


def deactivate_user(*, user_id: int, acting_admin_id: int) -> User:
    return update_user(
        user_id=user_id,
        acting_admin_id=acting_admin_id,
        full_name=None,
        email=None,
        zone_id=None,
        change_zone=False,
        active=False,
    )


def reset_password(*, user_id: int, new_password: str) -> None:
    """POST /admin/users/{id}/reset-password — admin sets a password directly.

    No current-password check, deliberately: the admin does not know it, which
    is the whole reason this exists. `require_role(ADMIN)` on the route is what
    authorizes it.

    Does NOT revoke sessions. JWTs here are stateless and carry no password
    generation, so a token already issued for this account keeps working until
    it expires. Deactivation is the tool for cutting off a live session, since
    `core.auth` re-reads `is_active` on every request.
    """
    with transaction():
        user = db.session.get(User, user_id)
        if user is None:
            raise NotFoundError("No such user.")
        user.password_hash = hash_password(new_password)


def delete_user(*, user_id: int, acting_admin_id: int) -> None:
    with transaction():
        user = db.session.get(User, user_id)
        if user is None:
            raise NotFoundError("No such user.")
        _guard_last_admin(user, acting_admin_id=acting_admin_id, verb="delete")
        blockers = {
            "complaintsFiled": db.session.scalar(
                select(func.count(Complaint.id)).where(Complaint.citizen_id == user_id)
            ),
            "complaintsAssigned": db.session.scalar(
                select(func.count(Complaint.id)).where(Complaint.assigned_officer_id == user_id)
            ),
            "ledgerRows": db.session.scalar(
                select(func.count(PointsLedger.id)).where(PointsLedger.citizen_id == user_id)
            ),
            "progressNotes": db.session.scalar(
                select(func.count(ComplaintNote.id)).where(ComplaintNote.officer_id == user_id)
            ),
            "evidenceReviews": db.session.scalar(
                select(func.count(ComplaintEvidence.id)).where(
                    ComplaintEvidence.reviewed_by == user_id
                )
            ),
            "statusHistory": db.session.scalar(
                select(func.count(StatusHistory.id)).where(
                    StatusHistory.changed_by_user_id == user_id
                )
            ),
        }
        nonzero = {key: int(value or 0) for key, value in blockers.items() if value}
        if nonzero:
            details = [ErrorDetail(field=key, issue=str(value)) for key, value in nonzero.items()]
            summary = ", ".join(f"{key}={value}" for key, value in nonzero.items())
            raise ConflictError(
                "HAS_LINKED_RECORDS",
                f"This account has linked records ({summary}) and cannot be hard-deleted. "
                "Deactivate it instead.",
                details=details,
            )
        db.session.delete(user)


def _clear_old_assignments(officer_id: int, old_zone_id: int | None) -> None:
    if old_zone_id is None:
        return
    db.session.execute(
        update(Complaint)
        .where(
            Complaint.assigned_officer_id == officer_id,
            Complaint.zone_id == old_zone_id,
            Complaint.status.not_in(TERMINAL),
        )
        .values(assigned_officer_id=None)
        .execution_options(synchronize_session="fetch")
    )


def reassign_officer_zone(*, officer_id: int, zone_id: int) -> User:
    with transaction():
        zone = db.session.get(Zone, zone_id)
        if zone is None:
            raise NotFoundError("No such zone.")
        officer = db.session.get(User, officer_id)
        if officer is None or officer.role is not UserRole.OFFICER:
            raise ValidationError("officerId does not refer to a known officer.")
        if officer.zone_id != zone_id:
            _clear_old_assignments(officer.id, officer.zone_id)
            officer.zone_id = zone_id
        return officer
