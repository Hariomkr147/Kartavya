"""Zone and ownership scoping, expressed as query builders.

Never fetch rows and filter them afterwards. Every complaint query starts from
`visible_complaints(user)`, so an officer's zone restriction becomes structurally
hard to forget: a missing `.where()` would have to be a deliberate deletion
rather than an omission.
"""

from __future__ import annotations

from sqlalchemy import Select, select

from app.domain.enums import UserRole
from app.domain.errors import ForbiddenError, NotFoundError
from app.models import Complaint, ComplaintCluster, User


def visible_complaints(user: User) -> Select[tuple[Complaint]]:
    """The only legitimate starting point for a complaint query.

    Current zone is re-read on every request so reassignments take effect immediately.
    """
    query = select(Complaint)
    if user.role is UserRole.CITIZEN:
        return query.where(Complaint.citizen_id == user.id)
    if user.role is UserRole.OFFICER:
        if user.zone_id is None:
            raise ForbiddenError("Your account is not assigned to a zone.")
        return query.where(Complaint.zone_id == user.zone_id)
    return query  # ADMIN sees everything


def visible_clusters(user: User) -> Select[tuple[ComplaintCluster]]:
    """Clusters follow the same rule. Citizens have no cluster endpoints."""
    query = select(ComplaintCluster)
    if user.role is UserRole.OFFICER:
        if user.zone_id is None:
            raise ForbiddenError("Your account is not assigned to a zone.")
        return query.where(ComplaintCluster.zone_id == user.zone_id)
    if user.role is UserRole.ADMIN:
        return query
    raise ForbiddenError("You do not have access to this resource.")


def assert_can_view_zone(user: User, zone_id: int) -> None:
    """`GET /zones/{id}/summary` — an officer may only summarise their own zone."""
    if user.role is UserRole.ADMIN:
        return
    if user.role is UserRole.OFFICER and user.zone_id == zone_id:
        return
    raise ForbiddenError("You do not have access to this zone.")


def not_found(what: str = "complaint") -> NotFoundError:
    """One message for "no such row" and "not yours".

    Distinguishing them would let a citizen probe which complaint IDs exist.
    """
    return NotFoundError(f"No such {what}.")
