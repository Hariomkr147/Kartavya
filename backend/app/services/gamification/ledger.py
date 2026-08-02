"""Append-only points ledger services."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select

from app.domain.enums import PointsReason
from app.domain.points import amount
from app.extensions import db
from app.models import PointsLedger


def award(
    *, citizen_id: int, complaint_id: int | None, reason: PointsReason, now: datetime
) -> PointsLedger:
    """Append one domain-priced ledger row and evaluate badges atomically."""
    entry = PointsLedger(
        citizen_id=citizen_id,
        complaint_id=complaint_id,
        points_change=amount(reason),
        reason=reason,
        created_at=now,
    )
    db.session.add(entry)
    db.session.flush()

    from app.services.gamification.badges import evaluate_and_award

    evaluate_and_award(citizen_id=citizen_id, now=now)
    return entry


def lifetime_points(*, citizen_id: int) -> int:
    """Return the sum of the citizen's complete ledger."""
    total = db.session.execute(
        select(func.coalesce(func.sum(PointsLedger.points_change), 0)).where(
            PointsLedger.citizen_id == citizen_id
        )
    ).scalar_one()
    return int(total)


def monthly_points(*, citizen_id: int, year: int, month: int) -> int:
    """Return one calendar month's points."""
    start = datetime(year, month, 1)
    end = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
    total = db.session.execute(
        select(func.coalesce(func.sum(PointsLedger.points_change), 0)).where(
            PointsLedger.citizen_id == citizen_id,
            PointsLedger.created_at >= start,
            PointsLedger.created_at < end,
        )
    ).scalar_one()
    return int(total)


def history(*, citizen_id: int, page: int, page_size: int) -> tuple[list[PointsLedger], int]:
    """Return the newest-first paginated points ledger."""
    from app.services.queries import clamp_page_args

    page, page_size = clamp_page_args(page, page_size, max_page_size=100)
    total = db.session.execute(
        select(func.count(PointsLedger.id)).where(PointsLedger.citizen_id == citizen_id)
    ).scalar_one()
    rows = list(
        db.session.execute(
            select(PointsLedger)
            .where(PointsLedger.citizen_id == citizen_id)
            .order_by(PointsLedger.created_at.desc(), PointsLedger.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).scalars()
    )
    return rows, int(total)
