"""Per-zone analytics: the officer dashboard and GET /zones/{id}/summary."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import func, select

from app.domain.enums import SeverityLabel, UserRole
from app.domain.lifecycle import TERMINAL
from app.domain.severity import label as severity_label
from app.domain.sla import average_resolution_hours, resolution_hours
from app.domain.sla import label as sla_label
from app.extensions import db
from app.models import Complaint, PointsLedger, User, Zone


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
    zone = db.session.get(Zone, zone_id)
    if zone is None:
        return {}
    rows = list(db.session.scalars(select(Complaint).where(Complaint.zone_id == zone_id)))
    active = [row for row in rows if row.status not in TERMINAL]
    resolved_month = [
        row
        for row in rows
        if row.resolved_at is not None
        and row.resolved_at.year == now.year
        and row.resolved_at.month == now.month
    ]
    heat = {label.value: 0 for label in SeverityLabel}
    overdue = 0
    for row in active:
        heat[severity_label(row.severity_score).value] += 1
        current_sla = sla_label(
            row.sla_target_hours,
            row.sla_started_at,
            row.sla_paused_seconds,
            row.sla_paused_at,
            now,
        )
        if current_sla is not None and current_sla.value == "OVERDUE":
            overdue += 1

    points = (
        select(
            User,
            func.coalesce(func.sum(PointsLedger.points_change), 0).label("points"),
        )
        .outerjoin(PointsLedger, PointsLedger.citizen_id == User.id)
        .where(
            User.role == UserRole.CITIZEN,
            User.is_active.is_(True),
            User.zone_id == zone_id,
        )
        .group_by(User.id)
        .order_by(
            func.coalesce(func.sum(PointsLedger.points_change), 0).desc(), User.created_at, User.id
        )
        .limit(3)
    )
    leaders = []
    for rank, (citizen, total) in enumerate(db.session.execute(points), start=1):
        leaders.append(
            {
                "rank": rank,
                "citizenId": str(citizen.id),
                "displayName": citizen.display_name or f"Citizen #{citizen.id}",
                "points": int(total),
                "isCurrentUser": False,
                "isTopThree": True,
            }
        )
    return {
        "zoneId": str(zone.id),
        "zoneName": zone.zone_name,
        "pending": len(active),
        "overdue": overdue,
        "resolvedThisMonth": len(resolved_month),
        "avgResolutionHours": average_resolution_hours(
            resolution_hours(row.resolved_at, row.sla_started_at, row.sla_paused_seconds)
            for row in resolved_month
        ),
        "isHighestOverdue": False,
        "topCitizens": leaders,
        "severityHeat": heat,
    }
