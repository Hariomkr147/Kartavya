"""The append-only points ledger.

INSERT only. There is no stored total anywhere in the system: lifetime CSP is
`SUM(points_change)`, monthly is the same sum filtered by month. That is
deliberate — a stored total can silently disagree with its rows.
"""

from __future__ import annotations

from datetime import datetime

from app.domain.enums import PointsReason
from app.domain.points import amount as get_amount
from app.extensions import db
from app.models import PointsLedger


def award(
    *, citizen_id: int, complaint_id: int | None, reason: PointsReason, now: datetime
) -> PointsLedger:
    """Append one ledger row, with the amount domain.points fixes for the reason."""
    pts = get_amount(reason)
    ledger_entry = PointsLedger(
        citizen_id=citizen_id,
        complaint_id=complaint_id,
        points_change=pts,
        reason=reason,
        created_at=now,
    )
    db.session.add(ledger_entry)
    db.session.flush()

    # TODO(phase 6): evaluate_and_award(citizen_id=citizen_id, now=now)
    # when gamification/badges.py lands.
    return ledger_entry


def lifetime_points(*, citizen_id: int) -> int:
    """SUM over the whole ledger. TODO(phase 6)."""
    raise NotImplementedError


def monthly_points(*, citizen_id: int, year: int, month: int) -> int:
    """SUM over one calendar month. TODO(phase 6)."""
    raise NotImplementedError


def history(*, citizen_id: int, page: int, page_size: int) -> tuple[list[PointsLedger], int]:
    """GET /gamification/points — the ledger, paginated, newest first.

    TODO(phase 6). Returns (rows, total_items) for the PaginationMeta envelope.
    """
    raise NotImplementedError
