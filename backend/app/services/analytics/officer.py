"""Officer performance analytics."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select

from app.domain.enums import ComplaintStatus, EvidenceVerdict, StatusActor, UserRole
from app.domain.errors import NotFoundError
from app.domain.sla import average_resolution_hours, resolution_hours
from app.domain.sla import label as sla_label
from app.extensions import db
from app.models import Complaint, ComplaintEvidence, StatusHistory, User


def _window(
    *, period: str, date_from: datetime | None, date_to: datetime | None, now: datetime
) -> tuple[datetime | None, datetime | None]:
    if date_from is not None or date_to is not None:
        return date_from, date_to
    month_start = datetime(now.year, now.month, 1)
    if period == "this_month":
        return month_start, now
    if period == "last_month":
        if now.month == 1:
            return datetime(now.year - 1, 12, 1), month_start - timedelta(microseconds=1)
        return datetime(now.year, now.month - 1, 1), month_start - timedelta(microseconds=1)
    return None, now


def _in_range(value: datetime, start: datetime | None, end: datetime | None) -> bool:
    return (start is None or value >= start) and (end is None or value <= end)


def officer_performance(
    *,
    officer_id: int,
    period: str,
    date_from: datetime | None,
    date_to: datetime | None,
    now: datetime,
) -> dict[str, Any]:
    officer = db.session.get(User, officer_id)
    if officer is None or officer.role is not UserRole.OFFICER:
        raise NotFoundError("No such officer.")
    start, end = _window(period=period, date_from=date_from, date_to=date_to, now=now)

    handled = [
        row
        for row in db.session.scalars(
            select(Complaint).where(Complaint.assigned_officer_id == officer_id)
        )
        if _in_range(row.created_at, start, end)
    ]
    excluded = [row for row in handled if row.status is ComplaintStatus.UNRESOLVABLE]
    labels = []
    for row in handled:
        if row.status is ComplaintStatus.UNRESOLVABLE:
            continue
        as_of = row.resolved_at or now
        current = sla_label(
            row.sla_target_hours,
            row.sla_started_at,
            row.sla_paused_seconds,
            row.sla_paused_at,
            as_of,
        )
        if current is not None:
            labels.append(current.value)

    reviewed = [
        row
        for row in db.session.scalars(
            select(ComplaintEvidence).where(
                ComplaintEvidence.reviewed_by == officer_id,
                ComplaintEvidence.reviewed_at.isnot(None),
            )
        )
        if row.reviewed_at is not None and _in_range(row.reviewed_at, start, end)
    ]
    valid = sum(row.verdict is EvidenceVerdict.VALID for row in reviewed)
    needs_more = sum(row.verdict is EvidenceVerdict.NEEDS_MORE_EVIDENCE for row in reviewed)
    rejected = sum(row.verdict is EvidenceVerdict.REJECTED for row in reviewed)

    resolution_rows = list(
        db.session.execute(
            select(StatusHistory)
            .where(
                StatusHistory.to_status == ComplaintStatus.RESOLVED,
            )
            .order_by(
                StatusHistory.complaint_id, StatusHistory.created_at.desc(), StatusHistory.id.desc()
            )
        ).scalars()
    )
    latest: dict[int, StatusHistory] = {}
    for history in resolution_rows:
        latest.setdefault(history.complaint_id, history)
    resolved = []
    for complaint_id, history in latest.items():
        if (
            history.actor_role is not StatusActor.OFFICER
            or history.changed_by_user_id != officer_id
        ):
            continue
        complaint = db.session.get(Complaint, complaint_id)
        if (
            complaint is not None
            and complaint.resolved_at is not None
            and _in_range(complaint.resolved_at, start, end)
        ):
            resolved.append(complaint)

    return {
        "officerId": str(officer.id),
        "zoneId": str(officer.zone_id) if officer.zone_id is not None else None,
        "period": period,
        "totalHandled": len(handled),
        "onTime": labels.count("ON_TIME"),
        "delayed": labels.count("DELAYED"),
        "overdue": labels.count("OVERDUE"),
        "unresolvableExcluded": len(excluded),
        "evidenceBreakdown": {
            "valid": valid,
            "needsMoreEvidence": needs_more,
            "rejected": rejected,
        },
        "acceptRejectRatio": valid / (valid + rejected) if valid + rejected else None,
        "avgResolutionHours": average_resolution_hours(
            resolution_hours(row.resolved_at, row.sla_started_at, row.sla_paused_seconds)
            for row in resolved
        ),
    }


def public_officer_stats(*, officer_id: int) -> dict[str, Any]:
    """Citizen-safe count only; implemented independently of the admin scorecard."""
    officer = db.session.get(User, officer_id)
    if officer is None or officer.role is not UserRole.OFFICER:
        raise NotFoundError("No such officer.")
    count = (
        db.session.query(Complaint)
        .filter_by(assigned_officer_id=officer_id, status=ComplaintStatus.RESOLVED)
        .count()
    )
    return {"officerId": str(officer_id), "totalResolved": count}
