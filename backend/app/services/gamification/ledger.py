"""The append-only points ledger.

INSERT only. There is no stored total anywhere in the system: lifetime CSP is
`SUM(points_change)`, monthly is the same sum filtered by month. That is
deliberate — a stored total can silently disagree with its rows.
"""

from __future__ import annotations

from datetime import datetime

from app.domain.enums import PointsReason
from app.models import PointsLedger


def award(
    *, citizen_id: int, complaint_id: int | None, reason: PointsReason, now: datetime
) -> PointsLedger:
    """Append one ledger row, with the amount `domain.points` fixes for the reason.

    TODO(phase 6). Callers never pass an amount — that would let two call sites
    disagree about what a COMPLAINT_CLOSED is worth.

    After awarding, re-evaluate badges (`gamification/badges.py`) in the same
    transaction: crossing 100 lifetime points and earning CENTURY_REFORMER must
    not be separable by a crash.
    """
    raise NotImplementedError


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
