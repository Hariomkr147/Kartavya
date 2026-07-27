"""The data-driven badge engine.

Badges are rows, not code. The `badges` table stores `criteria_type`,
`criteria_value` and `criteria_count`; this module evaluates one criterion
against a snapshot of a citizen's stats. Adding a seventh badge should be a seed
change, never a code change.

The service layer (`app/services/gamification/badges.py`) gathers the snapshot
and does the inserting; this file stays pure so every criterion boundary is
cheap to test.

Ported from `frontend/src/mocks/lib/points.ts` (checkAndAwardBadges).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from app.domain.enums import BadgeCriteriaType


@dataclass(frozen=True)
class BadgeCriteria:
    """One row of the `badges` table, as far as the rules care."""

    criteria_type: BadgeCriteriaType
    criteria_value: int | None = None
    criteria_count: int | None = None


@dataclass(frozen=True)
class CitizenStats:
    """Everything the criteria can ask about a citizen, gathered once.

    Passed in whole so the engine never queries — evaluating six badges must not
    become six round trips.
    """

    complaints_filed: int = 0
    complaints_closed: int = 0
    lifetime_points: int = 0
    is_zone_rank_one: bool = False
    #: `closed_at` of every complaint this citizen has closed, any order.
    closed_at_timestamps: list[datetime] = field(default_factory=list)


def has_closures_within_window(
    timestamps: list[datetime], days: int, count: int
) -> bool:
    """True if `count` closures fall inside any rolling `days`-day window.

    Sliding window over the sorted list: if the (i + count - 1)th closure is
    within the window of the ith, the badge is earned.
    """
    if count <= 0:
        return True
    ordered = sorted(timestamps)
    if len(ordered) < count:
        return False
    window_seconds = days * 24 * 3600
    for i in range(len(ordered) - count + 1):
        if (ordered[i + count - 1] - ordered[i]).total_seconds() <= window_seconds:
            return True
    return False


def is_earned(criteria: BadgeCriteria, stats: CitizenStats) -> bool:
    """Evaluate one badge's criteria against a citizen's current stats.

    A criterion with a missing threshold is treated as unearnable rather than
    always-earned — a null `criteria_value` on a COMPLAINTS_CLOSED row is a seed
    bug, and awarding the badge to everyone would be the worse failure.
    """
    match criteria.criteria_type:
        case BadgeCriteriaType.FIRST_COMPLAINT:
            return stats.complaints_filed >= 1
        case BadgeCriteriaType.COMPLAINTS_CLOSED:
            if criteria.criteria_value is None:
                return False
            return stats.complaints_closed >= criteria.criteria_value
        case BadgeCriteriaType.LIFETIME_POINTS:
            if criteria.criteria_value is None:
                return False
            return stats.lifetime_points >= criteria.criteria_value
        case BadgeCriteriaType.ZONE_RANK_ONE:
            return stats.is_zone_rank_one
        case BadgeCriteriaType.CLOSED_WITHIN_DAYS:
            if criteria.criteria_value is None or criteria.criteria_count is None:
                return False
            return has_closures_within_window(
                stats.closed_at_timestamps,
                days=criteria.criteria_value,
                count=criteria.criteria_count,
            )
    return False  # pragma: no cover - exhaustive above
