"""Leaderboards — a total order over active citizens."""

from __future__ import annotations

from typing import Any


def leaderboard(
    *, zone_id: int | None, page: int, page_size: int
) -> tuple[list[dict[str, Any]], int]:
    """GET /leaderboard. TODO(phase 6).

    Four rules the contract settles, all of which have a reason:

      * Sort by lifetime points, then account age, then id. THREE keys, so the
        order is total — with fewer, two equal-point citizens could interleave
        differently between two page requests and a row could appear twice or
        never.
      * Ranks are SEQUENTIAL (1, 2, 3, 4), not shared (1, 2, 2, 4), so
        `isTopThree` means exactly `rank <= 3` and pagination stays honest.
      * DEACTIVATED citizens are excluded — everyone below moves up. Their
        ledger rows survive, so reactivating restores their standing.
        (The frontend mock currently includes them; the backend must not.)
      * ZERO-POINT citizens stay on the board. A new citizen seeing themselves
        at the bottom is the nudge the feature exists for.

    Returns (entries, total_items).
    """
    raise NotImplementedError


def zone_rank(*, citizen_id: int) -> int | None:
    """This citizen's position within their own zone. TODO(phase 6).

    Feeds both the gamification page and the ZONE_RANK_ONE badge criterion.
    """
    raise NotImplementedError
