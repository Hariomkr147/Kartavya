"""SLA arithmetic — the calculation most likely to be wrong in the system.

Every complaint carries a frozen snapshot of its own SLA target
(`sla_target_hours`), taken at acceptance, so a later admin edit to a category's
SLA cannot retroactively move complaints already in flight.

`now` is always a parameter, never `datetime.now()`. That is what lets the
boundary tests (79 % / 80 % / 99 % / 100 %) be exact instead of flaky.

Ported from `frontend/src/mocks/lib/sla.ts`.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from app.domain.enums import SlaLabel

SECONDS_PER_HOUR = 3600.0

#: Percent-of-target thresholds. < 80 % ON_TIME, 80-100 % DELAYED, > 100 % OVERDUE.
DELAYED_THRESHOLD_PCT = 80.0
OVERDUE_THRESHOLD_PCT = 100.0


def elapsed_seconds(
    started_at: datetime,
    paused_seconds: int,
    paused_at: datetime | None,
    now: datetime,
) -> float:
    """Seconds actually counted against the target.

    Wall-clock since the clock started, minus accumulated pause time, minus any
    currently-open pause that has not yet been folded into `paused_seconds`.

    Paused time must never count against the SLA: a complaint sitting three days
    waiting on a citizen's photo has not consumed three days of the officer's
    target.
    """
    total_paused = float(paused_seconds)
    if paused_at is not None:
        total_paused += (now - paused_at).total_seconds()
    return (now - started_at).total_seconds() - total_paused


def percent_consumed(
    target_hours: int,
    started_at: datetime,
    paused_seconds: int,
    paused_at: datetime | None,
    now: datetime,
) -> float:
    elapsed_hours = elapsed_seconds(started_at, paused_seconds, paused_at, now) / SECONDS_PER_HOUR
    return (elapsed_hours / target_hours) * 100.0


def label(
    target_hours: int | None,
    started_at: datetime | None,
    paused_seconds: int,
    paused_at: datetime | None,
    now: datetime,
) -> SlaLabel | None:
    """Derived on read, never stored.

    None before acceptance — no clock, no label. The API emits `slaLabel: null`
    there rather than pretending a complaint waiting for an officer is ON_TIME.
    """
    if target_hours is None or started_at is None:
        return None
    pct = percent_consumed(target_hours, started_at, paused_seconds, paused_at, now)
    if pct < DELAYED_THRESHOLD_PCT:
        return SlaLabel.ON_TIME
    if pct < OVERDUE_THRESHOLD_PCT:
        return SlaLabel.DELAYED
    return SlaLabel.OVERDUE


# --- The clock's four write moments ------------------------------------------
# These compute the new column values; app/services/complaints/lifecycle.py is
# what actually assigns them, inside the same transaction as the status write.


def start(now: datetime, category_sla_hours: int) -> tuple[int, datetime]:
    """Evidence-review verdict VALID. Returns (sla_target_hours, sla_started_at).

    The target is snapshotted from the category *as it is right now*.
    """
    return category_sla_hours, now


def pause(started_at: datetime | None, now: datetime) -> datetime | None:
    """Entering NEEDS_MORE_EVIDENCE. Returns the new `sla_paused_at`.

    A no-op (None) when the clock never started — the pre-acceptance
    NEEDS_MORE_EVIDENCE loop has nothing to pause. Only the officer's later
    recall of an already-accepted complaint pauses a running clock.
    """
    if started_at is None:
        return None
    return now


def resume(paused_seconds: int, paused_at: datetime | None, now: datetime) -> tuple[int, None]:
    """Leaving NEEDS_MORE_EVIDENCE. Returns (new sla_paused_seconds, cleared paused_at)."""
    if paused_at is None:
        return paused_seconds, None
    return paused_seconds + int((now - paused_at).total_seconds()), None


def needs_backfill(target_hours: int | None, started_at: datetime | None) -> bool:
    """True when an admin override lands at UNDER_REVIEW-or-later with no clock.

    Without the backfill, `slaLabel` comes back silently null on an overridden
    complaint and the officer's dashboards quietly lose it. Pair this with
    `lifecycle.AT_OR_PAST_UNDER_REVIEW`.
    """
    return target_hours is None or started_at is None


# --- avgResolutionHours ------------------------------------------------------


def resolution_hours(
    resolved_at: datetime | None,
    started_at: datetime | None,
    paused_seconds: int,
) -> float | None:
    """`resolved_at - sla_started_at - sla_paused_seconds`, in hours.

    The same arithmetic `label()` uses, deliberately: a zone must never be able
    to show every complaint ON_TIME next to an average past its target.

    It starts at *acceptance*, not filing — time queued before an officer claims
    it is a backlog problem, visible in pending/overdueCount. It stops at
    `resolved_at`, not `closed_at` — the wait for the citizen's confirm is not
    the officer's to answer for.

    None when the complaint is not in the sample at all: never resolved, or
    resolved without the clock ever starting.

    NOTE: the frontend mock computes this three other ways
    (`closedAt - createdAt`, `resolvedAt - createdAt`). The contract's
    `AvgResolutionHours` schema wins; the mock is the one place in the project
    that is not a usable reference implementation.
    """
    if resolved_at is None or started_at is None:
        return None
    span = (resolved_at - started_at).total_seconds()
    return (span - paused_seconds) / SECONDS_PER_HOUR


def average_resolution_hours(samples: Iterable[float | None]) -> float | None:
    """Mean over a sample, or None — never 0 — when the sample is empty.

    "Nothing resolved yet" must not be readable as "resolved instantly".
    Complaints outside the sample are skipped, not counted as zero.
    """
    values = [h for h in samples if h is not None]
    if not values:
        return None
    return sum(values) / len(values)
