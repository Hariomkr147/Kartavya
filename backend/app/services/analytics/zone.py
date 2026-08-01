"""Per-zone analytics: the officer dashboard and GET /zones/{id}/summary."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select

from app.domain import lifecycle, sla
from app.domain.enums import SlaLabel
from app.domain.errors import NotFoundError
from app.extensions import db
from app.models import Complaint, ComplaintCategory, Zone


def _database_time(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def zone_analytics(
    *,
    zone_id: int,
    now: datetime,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> dict[str, Any]:
    """GET /officer/analytics and GET /zones/{id}/summary.

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
    zone = db.session.get(Zone, zone_id)
    if zone is None:
        raise NotFoundError("No such zone.")

    date_from = _database_time(date_from)
    date_to = _database_time(date_to)
    all_rows = (
        db.session.execute(select(Complaint).where(Complaint.zone_id == zone_id)).scalars().all()
    )
    rows = [
        complaint
        for complaint in all_rows
        if (date_from is None or complaint.created_at >= date_from)
        and (date_to is None or complaint.created_at <= date_to)
    ]

    active_count = sum(complaint.status not in lifecycle.TERMINAL for complaint in rows)
    overdue_count = sum(
        sla.label(
            complaint.sla_target_hours,
            complaint.sla_started_at,
            complaint.sla_paused_seconds,
            complaint.sla_paused_at,
            now,
        )
        == SlaLabel.OVERDUE
        for complaint in rows
    )
    monthly = [
        complaint
        for complaint in all_rows
        if complaint.resolved_at is not None
        and complaint.resolved_at.year == now.year
        and complaint.resolved_at.month == now.month
    ]
    average = sla.average_resolution_hours(
        sla.resolution_hours(
            complaint.resolved_at,
            complaint.sla_started_at,
            complaint.sla_paused_seconds,
        )
        for complaint in monthly
    )

    counts: dict[int, int] = {}
    for complaint in rows:
        counts[complaint.category_id] = counts.get(complaint.category_id, 0) + 1
    categories = (
        db.session.execute(select(ComplaintCategory).where(ComplaintCategory.id.in_(counts)))
        .scalars()
        .all()
        if counts
        else []
    )

    return {
        "zoneId": str(zone.id),
        "zoneName": zone.zone_name,
        "activeComplaints": active_count,
        "overdueCount": overdue_count,
        "avgResolutionHoursThisMonth": average,
        "categoryBreakdown": [
            {
                "categoryId": str(category.id),
                "categoryName": category.category_name,
                "count": counts[category.id],
            }
            for category in sorted(categories, key=lambda item: item.id)
        ],
    }


def zone_metrics(*, zone_id: int, now: datetime) -> dict[str, Any]:
    """The ZoneMetrics block inside SystemAnalytics. TODO(phase 7)."""
    raise NotImplementedError
