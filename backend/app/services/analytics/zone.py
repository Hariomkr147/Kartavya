"""Per-zone analytics: the officer dashboard and GET /zones/{id}/summary."""

from __future__ import annotations

from datetime import datetime
from typing import Any


def zone_analytics(*, zone_id: int, now: datetime) -> dict[str, Any]:
    """GET /officer/analytics and GET /zones/{id}/summary. TODO(phase 5).

    `avgResolutionHours` is `resolved_at - sla_started_at - sla_paused_seconds`
    — `domain.sla.resolution_hours` — averaged over resolved complaints, and
    None (never 0) when nothing has resolved yet.

    It is the SAME arithmetic slaLabel uses, deliberately: a zone showing every
    complaint ON_TIME next to an average past its target would destroy trust in
    both numbers.

    Two consequences to internalise:
      * It STARTS at acceptance, not filing. Time queued before an officer
        claims a complaint is a backlog problem, and it shows up in
        pending/overdueCount instead.
      * It ENDS at resolved_at, not closed_at. The gap between "officer fixed
        it" and "citizen confirmed it" belongs to the citizen (or to the
        auto-close timeout), and charging it here would make officers look worse
        the slower their citizens are.

    WARNING: the three mock implementations use `closedAt - createdAt` or
    `resolvedAt - createdAt` over three different windows. The contract wins.
    This is the one place the mock is NOT a usable reference.
    """
    raise NotImplementedError


def zone_metrics(*, zone_id: int, now: datetime) -> dict[str, Any]:
    """The ZoneMetrics block inside SystemAnalytics. TODO(phase 7)."""
    raise NotImplementedError
