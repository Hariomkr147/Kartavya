"""User management services."""

from __future__ import annotations

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


def update_own_profile(*, user: User, full_name: str | None, display_name: str | None) -> User:
    """PATCH /users/me. TODO(phase 2); retained for that endpoint's service boundary."""
    raise NotImplementedError


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


def update_user(
    *,
    user_id: int,
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


def deactivate_user(*, user_id: int) -> User:
    return update_user(
        user_id=user_id,
        full_name=None,
        email=None,
        zone_id=None,
        change_zone=False,
        active=False,
    )


def delete_user(*, user_id: int) -> None:
    with transaction():
        user = db.session.get(User, user_id)
        if user is None:
            raise NotFoundError("No such user.")
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
