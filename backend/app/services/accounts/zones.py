"""Zone CRUD and nearest-zone suggestion."""

from __future__ import annotations

from sqlalchemy import func, select

from app.core.session import transaction
from app.domain.enums import UserRole
from app.domain.errors import ConflictError, ErrorDetail, NotFoundError, ValidationError
from app.extensions import db
from app.models import Complaint, User, Zone


def list_zones(*, active_only: bool = False) -> list[Zone]:
    """GET /zones."""
    from app.extensions import db
    q = db.select(Zone)
    if active_only:
        q = q.filter_by(is_active=True)
    return list(db.session.scalars(q))


def suggest_zone(*, latitude: float, longitude: float) -> Zone | None:
    """POST /zones/suggest."""
    from app.domain.geo import nearest_active_zone
    zones = list_zones(active_only=True)
    return nearest_active_zone(zones, latitude, longitude)


def create_zone(*, zone_code: str, zone_name: str, center_lat: float, center_lng: float) -> Zone:
    """POST /admin/zones. `zone_code` is immutable once created."""
    code = zone_code.strip()
    if db.session.scalar(select(Zone.id).where(Zone.zone_code == code)) is not None:
        raise ConflictError("ZONE_CODE_TAKEN", "A zone with this code already exists.")
    with transaction():
        zone = Zone(
            zone_code=code,
            zone_name=zone_name.strip(),
            center_lat=center_lat,
            center_lng=center_lng,
            is_catch_all=False,
            is_active=True,
        )
        db.session.add(zone)
        db.session.flush()
        return zone


def update_zone(
    *,
    zone_id: int,
    zone_name: str | None,
    center_lat: float | None,
    center_lng: float | None,
    is_active: bool | None,
) -> Zone:
    """PATCH /admin/zones/{id}.

    A rename changes `zone_name` only — never `zone_code`. Moving the centre
    changes future routing but NOT existing complaints: a complaint's zone is a
    snapshot taken at submit time.

    The catch-all zone can be renamed but never deactivated.
    """
    with transaction():
        zone = db.session.get(Zone, zone_id)
        if zone is None:
            raise NotFoundError("No such zone.")
        if is_active is False and zone.is_catch_all:
            raise ValidationError("The catch-all zone cannot be deactivated.")
        if zone_name is not None:
            zone.zone_name = zone_name.strip()
        if center_lat is not None:
            zone.center_lat = center_lat
        if center_lng is not None:
            zone.center_lng = center_lng
        if is_active is not None:
            zone.is_active = is_active
        return zone


def delete_zone(*, zone_id: int) -> None:
    """DELETE /admin/zones/{id}. Pre-check the RESTRICT blockers.

    Count first, 409 with a useful message — never let the IntegrityError become
    a 500. Blockers:
      * complaints in this zone
      * officers assigned to it
      * CITIZENS whose home zone this is (easy to forget: registration requires
        a home zone, so any zone real users signed up against is blocked)
      * `is_catch_all` — never deletable, full stop.
    """
    with transaction():
        zone = db.session.get(Zone, zone_id)
        if zone is None:
            raise NotFoundError("No such zone.")
        blockers = {
            "catchAll": 1 if zone.is_catch_all else 0,
            "complaints": db.session.scalar(
                select(func.count(Complaint.id)).where(Complaint.zone_id == zone_id)
            ),
            "officers": db.session.scalar(
                select(func.count(User.id)).where(
                    User.zone_id == zone_id, User.role == UserRole.OFFICER
                )
            ),
            "citizens": db.session.scalar(
                select(func.count(User.id)).where(
                    User.zone_id == zone_id, User.role == UserRole.CITIZEN
                )
            ),
        }
        nonzero = {key: int(value or 0) for key, value in blockers.items() if value}
        if nonzero:
            summary = ", ".join(f"{key}={value}" for key, value in nonzero.items())
            raise ConflictError(
                "ZONE_IN_USE",
                f"This zone cannot be deleted ({summary}). Deactivate it instead.",
                details=[
                    ErrorDetail(field=key, issue=str(value)) for key, value in nonzero.items()
                ],
            )
        db.session.delete(zone)
