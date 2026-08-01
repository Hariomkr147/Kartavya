"""The append-only points ledger."""

from __future__ import annotations

from datetime import datetime
from sqlalchemy import select, func

from app.domain.enums import PointsReason
from app.models import PointsLedger
from app.extensions import db
from app.domain.points import amount

def award(
    *, citizen_id: int, complaint_id: int | None, reason: PointsReason, now: datetime
) -> PointsLedger:
    """Append one ledger row, with the amount domain.points fixes for the reason."""
    amt = amount(reason)
    ledger_row = PointsLedger(
        citizen_id=citizen_id,
        complaint_id=complaint_id,
        points_change=amt,
        reason=reason,
        created_at=now
    )
    db.session.add(ledger_row)
    db.session.flush()

    from app.services.gamification.badges import evaluate_and_award
    evaluate_and_award(citizen_id=citizen_id, now=now)

    return ledger_row

def lifetime_points(*, citizen_id: int) -> int:
    return db.session.scalar(
        select(func.sum(PointsLedger.points_change)).where(
            PointsLedger.citizen_id == citizen_id
        )
    ) or 0

def monthly_points(*, citizen_id: int, year: int, month: int) -> int:
    # SQLITE compatibility: use python datetime or string compare depending on dialect
    start = datetime(year, month, 1)
    if month == 12:
        end = datetime(year + 1, 1, 1)
    else:
        end = datetime(year, month + 1, 1)
    
    return db.session.scalar(
        select(func.sum(PointsLedger.points_change)).where(
            PointsLedger.citizen_id == citizen_id,
            PointsLedger.created_at >= start,
            PointsLedger.created_at < end
        )
    ) or 0

def history(*, citizen_id: int, page: int, page_size: int) -> tuple[list[PointsLedger], int]:
    from app.services.queries import clamp_page_args
    page, page_size = clamp_page_args(page, page_size, max_page_size=100)
    
    total_items = db.session.scalar(
        select(func.count(PointsLedger.id)).where(PointsLedger.citizen_id == citizen_id)
    ) or 0

    rows = list(db.session.scalars(
        select(PointsLedger)
        .where(PointsLedger.citizen_id == citizen_id)
        .order_by(PointsLedger.created_at.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all())

    return rows, total_items
