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
    """Return one calendar month's points. Implemented with Phase 6."""
    raise NotImplementedError


def history(*, citizen_id: int, page: int, page_size: int) -> tuple[list[PointsLedger], int]:
    """Return the paginated points ledger. Implemented with Phase 6."""
    raise NotImplementedError
