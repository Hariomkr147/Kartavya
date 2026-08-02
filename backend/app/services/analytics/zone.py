"""Per-zone analytics: the officer dashboard and GET /zones/{id}/summary."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from flask import current_app
from sqlalchemy import func, select

from app.domain import lifecycle, sla
from app.domain.enums import (
    AiReportStatus,
    ComplaintStatus,
    SeverityLabel,
    SlaLabel,
    UserRole,
)
from app.domain.errors import NotFoundError
from app.domain.lifecycle import TERMINAL
from app.domain.severity import label as severity_label
from app.domain.sla import average_resolution_hours, resolution_hours
from app.domain.sla import label as sla_label
from app.extensions import db
from app.jobs.zone_report import submit_zone_report_job
from app.models import AiZoneReport, Complaint, ComplaintCategory, PointsLedger, User, Zone

logger = logging.getLogger(__name__)


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


def zone_summary(*, zone_id: int) -> dict[str, Any]:
    """GET /zones/{zoneId}/summary — openapi.yaml: ZoneSummary.

    `resolvedComplaints` counts everything that reached a resolution, which
    includes CLOSED: a complaint the citizen confirmed is *more* resolved than
    one still waiting on them, and counting only the RESOLVED status would make
    a healthy zone report zero.

    `activeClusters` is derived from member statuses, never stored — a cluster
    is active while any member is still non-terminal.
    """
    zone = db.session.get(Zone, zone_id)
    if zone is None:
        raise NotFoundError("No such zone.")

    rows = list(db.session.scalars(select(Complaint).where(Complaint.zone_id == zone_id)))
    active = [row for row in rows if row.status not in TERMINAL]
    resolved = [
        row
        for row in rows
        if row.status in {ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED}
    ]

    cluster_ids = {row.cluster_id for row in rows if row.cluster_id is not None}
    active_cluster_ids = {row.cluster_id for row in active if row.cluster_id is not None}

    return {
        "zoneId": str(zone.id),
        "totalComplaints": len(rows),
        "activeComplaints": len(active),
        "resolvedComplaints": len(resolved),
        "totalClusters": len(cluster_ids),
        "activeClusters": len(active_cluster_ids),
    }


def zone_metrics(*, zone_id: int, now: datetime) -> dict[str, Any]:
    """The ZoneMetrics block inside SystemAnalytics."""
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


def request_ai_zone_report(*, zone_id: int, admin_user: User, now: datetime) -> AiZoneReport:
    """Request generation of an AI zone health report."""
    zone = db.session.get(Zone, zone_id)
    if zone is None:
        raise NotFoundError("No such zone.")

    report = AiZoneReport(
        zone_id=zone_id,
        requested_by=admin_user.id,
        status=AiReportStatus.PENDING,
        ai_available=True,
        created_at=now,
    )
    db.session.add(report)
    db.session.commit()

    app_obj = current_app._get_current_object()
    try:
        submit_zone_report_job(app_obj, report.id)
    except Exception:
        logger.exception("Failed to submit AI zone report job %d", report.id)
        report.status = AiReportStatus.FAILED
        report.ai_available = False
        report.generated_at = now
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()

    return report


def get_latest_ai_zone_report(*, zone_id: int) -> AiZoneReport:
    """Fetch latest AI zone report for a zone."""
    zone = db.session.get(Zone, zone_id)
    if zone is None:
        raise NotFoundError("No such zone.")

    stmt = (
        select(AiZoneReport)
        .where(AiZoneReport.zone_id == zone_id)
        .order_by(AiZoneReport.created_at.desc())
        .limit(1)
    )
    report = db.session.scalar(stmt)
    if report is None:
        raise NotFoundError("No AI report has ever been generated for this zone.")
    return report
