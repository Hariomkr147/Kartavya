"""Officer performance — the admin view, and the citizen-safe public view."""

from __future__ import annotations

from datetime import datetime
from typing import Any


def officer_performance(*, officer_id: int, now: datetime) -> dict[str, Any]:
    """GET /admin/officers/{id}/performance — OfficerPerformance. TODO(phase 7).

    Admin only. May name the officer.
    """
    raise NotImplementedError


def public_officer_stats(*, officer_id: int) -> dict[str, Any]:
    """GET /officers/{id}/stats — any authenticated role. TODO(phase 4).

    Deliberately tiny: a resolved count and nothing else. Officers are
    identified to citizens by ID, never by name, so do NOT add `fullName` here
    however convenient it would be for the UI.
    """
    raise NotImplementedError
