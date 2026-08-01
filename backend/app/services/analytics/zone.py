"""Per-zone analytics: the officer dashboard and GET /zones/{id}/summary."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import TYPE_CHECKING, Any

from flask import current_app
from sqlalchemy import select

from app.domain.enums import AiReportStatus
from app.domain.errors import NotFoundError
from app.extensions import db
from app.jobs.zone_report import submit_zone_report_job
from app.models.accounts import Zone
from app.models.system import AiZoneReport

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from app.models.accounts import User


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
