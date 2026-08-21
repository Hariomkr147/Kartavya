"""Distance and zone matching.

Zones have no polygons and no radius — a zone is a centre point, and a location
belongs to whichever *active* zone's centre is nearest. That guarantees every
coordinate maps to exactly one zone, with no gaps and no overlaps.

Ported from `frontend/src/mocks/lib/geo.ts`.
"""

from __future__ import annotations

from collections.abc import Sequence
from math import asin, cos, radians, sin, sqrt
from typing import Protocol, TypeVar

EARTH_RADIUS_METERS = 6_371_000.0


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in metres."""
    d_lat = radians(lat2 - lat1)
    d_lng = radians(lng2 - lng1)
    a = sin(d_lat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lng / 2) ** 2
    return 2 * EARTH_RADIUS_METERS * asin(sqrt(a))


class HasCenter(Protocol):
    """Structural type for anything with a centre and an active flag."""

    center_lat: float
    center_lng: float
    is_active: bool


Z = TypeVar("Z", bound=HasCenter)


def nearest_active_zone(zones: Sequence[Z], lat: float, lng: float) -> Z | None:
    """Nearest-centroid matching, inactive zones excluded.

    The filter is the point: `/zones/suggest` must never pre-fill a zone that
    `POST /complaints` would then reject. Returns None only when no zone is
    active at all — which the catch-all zone should make impossible in practice.

    The server never routes a complaint by itself. `CreateComplaintRequest.zoneId`
    is required and trusted (checked only for existence and active-ness); this
    function exists to help the *client* pre-fill a choice the citizen confirms.
    """
    active = [z for z in zones if z.is_active]
    if not active:
        return None
    return min(active, key=lambda z: haversine_meters(lat, lng, z.center_lat, z.center_lng))


def within_radius(lat1: float, lng1: float, lat2: float, lng2: float, radius_meters: float) -> bool:
    """Used by clustering: same category, same zone, and inside this radius."""
    return haversine_meters(lat1, lng1, lat2, lng2) <= radius_meters


def centroid(points: Sequence[tuple[float, float]]) -> tuple[float, float]:
    """Mean of a cluster's member coordinates. Recomputed on every membership change."""
    if not points:
        raise ValueError("centroid() needs at least one point")
    return (
        sum(p[0] for p in points) / len(points),
        sum(p[1] for p in points) / len(points),
    )
