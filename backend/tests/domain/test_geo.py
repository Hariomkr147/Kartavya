"""Haversine distance and nearest-centroid zone matching."""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from app.domain import geo

pytestmark = pytest.mark.domain


@dataclass
class FakeZone:
    center_lat: float
    center_lng: float
    is_active: bool = True
    name: str = ""


class TestHaversine:
    def test_zero_distance(self):
        assert geo.haversine_meters(12.97, 77.59, 12.97, 77.59) == 0.0

    def test_known_distance_is_within_a_percent(self):
        """Bengaluru to Mysore, roughly 127 km."""
        metres = geo.haversine_meters(12.9716, 77.5946, 12.2958, 76.6394)
        assert 125_000 < metres < 130_000

    def test_symmetric(self):
        a = geo.haversine_meters(12.97, 77.59, 12.95, 77.57)
        b = geo.haversine_meters(12.95, 77.57, 12.97, 77.59)
        assert a == pytest.approx(b)


class TestNearestActiveZone:
    def test_picks_the_closest_centre(self):
        zones = [
            FakeZone(12.9716, 77.5946, name="north"),
            FakeZone(12.9510, 77.5712, name="south"),
        ]
        assert geo.nearest_active_zone(zones, 12.9700, 77.5950).name == "north"

    def test_inactive_zones_are_excluded(self):
        """/zones/suggest must never pre-fill a zone POST /complaints would reject."""
        zones = [
            FakeZone(12.9716, 77.5946, is_active=False, name="near-but-inactive"),
            FakeZone(12.9510, 77.5712, name="far-but-active"),
        ]
        assert geo.nearest_active_zone(zones, 12.9700, 77.5950).name == "far-but-active"

    def test_none_when_nothing_is_active(self):
        assert geo.nearest_active_zone([FakeZone(0, 0, is_active=False)], 1, 1) is None

    def test_every_coordinate_maps_somewhere(self):
        """Nearest-centroid means no gaps and no overlaps — even mid-ocean."""
        zones = [FakeZone(12.97, 77.59), FakeZone(12.95, 77.57)]
        assert geo.nearest_active_zone(zones, -40.0, 170.0) is not None


class TestCentroid:
    def test_mean_of_the_members(self):
        assert geo.centroid([(0.0, 0.0), (2.0, 4.0)]) == (1.0, 2.0)

    def test_empty_is_an_error_not_a_zero_point(self):
        with pytest.raises(ValueError):
            geo.centroid([])


def test_within_radius_is_inclusive_at_the_boundary():
    assert geo.within_radius(12.97, 77.59, 12.97, 77.59, 0)
