"""The badge award engine's I/O half. The rules half is `domain/badges.py`."""

from __future__ import annotations

from datetime import datetime

from app.domain.badges import CitizenStats
from app.models import CitizenBadge


def gather_stats(*, citizen_id: int) -> CitizenStats:
    """Collect everything the criteria can ask about, in as few queries as possible.

    TODO(phase 6). Needs: complaints filed, complaints closed, lifetime points,
    whether this citizen is #1 on their zone's leaderboard, and the `closed_at`
    of every complaint they have closed.
    """
    raise NotImplementedError


def evaluate_and_award(*, citizen_id: int, now: datetime) -> list[CitizenBadge]:
    """Award every not-yet-earned badge whose criteria now hold.

    TODO(phase 6). Load the `badges` rows, gather stats ONCE, and run
    `domain.badges.is_earned` per badge — the engine is data-driven, so adding a
    seventh badge is a seed change, not a code change.

    Check membership before inserting rather than relying on the
    (citizen_id, badge_id) unique index to raise: the index is the backstop, but
    a clean result beats catching an IntegrityError.

    Call after: complaint filed, complaint closed, points awarded, and any
    leaderboard-affecting change.
    """
    raise NotImplementedError
