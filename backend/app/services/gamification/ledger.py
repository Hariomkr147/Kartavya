"""The append-only points ledger.

INSERT only. There is no stored total anywhere in the system: lifetime CSP is
`SUM(points_change)`, monthly is the same sum filtered by month. That is
deliberate — a stored total can silently disagree with its rows.
"""

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
    """Append one ledger row, with the amount `domain.points` fixes for the reason.

    Callers never pass an amount — that would let two call sites
    disagree about what a COMPLAINT_CLOSED is worth.

    After awarding, re-evaluate badges (`gamification/badges.py`) in the same
    transaction: crossing 100 lifetime points and earning CENTURY_REFORMER must
    not be separable by a crash.
    """
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
    """SUM over the whole ledger."""
    total = db.session.execute(
        select(func.coalesce(func.sum(PointsLedger.points_change), 0)).where(
            PointsLedger.citizen_id == citizen_id
        )
    ).scalar_one()
    return int(total)


def monthly_points(*, citizen_id: int, year: int, month: int) -> int:
    """SUM over one calendar month. TODO(phase 6)."""
    raise NotImplementedError


def history(*, citizen_id: int, page: int, page_size: int) -> tuple[list[PointsLedger], int]:
    """GET /gamification/points — the ledger, paginated, newest first.

    TODO(phase 6). Returns (rows, total_items) for the PaginationMeta envelope.
    """
    raise NotImplementedError
