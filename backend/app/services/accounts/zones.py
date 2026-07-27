"""Zone CRUD and nearest-zone suggestion."""

from __future__ import annotations

from app.models import Zone


def list_zones(*, active_only: bool = False) -> list[Zone]:
    """GET /zones — public, because the registration form needs it. TODO(phase 2)."""
    raise NotImplementedError


def suggest_zone(*, latitude: float, longitude: float) -> Zone | None:
    """POST /zones/suggest — requires a token, despite sitting next to the
    public reference lookups. TODO(phase 2).

    Thin wrapper over `domain.geo.nearest_active_zone`. Inactive zones are
    excluded so this never pre-fills a zone POST /complaints would then reject.

    This is a SUGGESTION. The citizen confirms it, and `CreateComplaintRequest.
    zoneId` is what the server stores.
    """
    raise NotImplementedError


def create_zone(*, zone_code: str, zone_name: str, center_lat: float, center_lng: float) -> Zone:
    """POST /admin/zones. TODO(phase 7). `zone_code` is immutable once created."""
    raise NotImplementedError


def update_zone(
    *,
    zone_id: int,
    zone_name: str | None,
    center_lat: float | None,
    center_lng: float | None,
    is_active: bool | None,
) -> Zone:
    """PATCH /admin/zones/{id}. TODO(phase 7).

    A rename changes `zone_name` only — never `zone_code`. Moving the centre
    changes future routing but NOT existing complaints: a complaint's zone is a
    snapshot taken at submit time.

    The catch-all zone can be renamed but never deactivated.
    """
    raise NotImplementedError


def delete_zone(*, zone_id: int) -> None:
    """DELETE /admin/zones/{id}. TODO(phase 7). Pre-check the RESTRICT blockers.

    Count first, 409 with a useful message — never let the IntegrityError become
    a 500. Blockers:
      * complaints in this zone
      * officers assigned to it
      * CITIZENS whose home zone this is (easy to forget: registration requires
        a home zone, so any zone real users signed up against is blocked)
      * `is_catch_all` — never deletable, full stop.
    """
    raise NotImplementedError
