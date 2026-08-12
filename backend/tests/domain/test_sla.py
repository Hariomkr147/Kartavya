"""SLA arithmetic — the calculation most likely to be wrong in the system.

Every threshold is tested from both sides. 79 % must be ON_TIME and 80 % must be
DELAYED; an off-by-one here is invisible in the UI until a dashboard quietly
disagrees with itself.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app.domain import sla
from app.domain.enums import SlaLabel

pytestmark = pytest.mark.domain

START = datetime(2026, 7, 20, 0, 0, 0)


def at(hours: float) -> datetime:
    return START + timedelta(hours=hours)


class TestElapsed:
    def test_plain_elapsed_time(self):
        assert sla.elapsed_seconds(START, 0, None, at(5)) == 5 * 3600

    def test_accumulated_pause_is_excluded(self):
        assert sla.elapsed_seconds(START, 3600, None, at(5)) == 4 * 3600

    def test_an_open_pause_is_excluded_too(self):
        """Paused at hour 2, still paused at hour 5: only 2 hours have counted."""
        assert sla.elapsed_seconds(START, 0, at(2), at(5)) == 2 * 3600

    def test_open_and_closed_pauses_both_count(self):
        assert sla.elapsed_seconds(START, 3600, at(3), at(6)) == 2 * 3600


class TestLabel:
    def test_no_label_before_acceptance(self):
        """No clock, no label — the API returns null rather than claiming ON_TIME."""
        assert sla.label(None, None, 0, None, at(1)) is None
        assert sla.label(24, None, 0, None, at(1)) is None
        assert sla.label(None, START, 0, None, at(1)) is None

    @pytest.mark.parametrize(
        ("hours_elapsed", "expected"),
        [
            (0, SlaLabel.ON_TIME),
            (79.9, SlaLabel.ON_TIME),  # just under 80 %
            (80.0, SlaLabel.DELAYED),  # exactly 80 %
            (99.9, SlaLabel.DELAYED),
            (100.0, SlaLabel.OVERDUE),  # exactly at target
            (150.0, SlaLabel.OVERDUE),
        ],
    )
    def test_band_boundaries_on_a_100_hour_target(self, hours_elapsed, expected):
        assert sla.label(100, START, 0, None, at(hours_elapsed)) is expected

    def test_paused_time_never_counts_against_the_target(self):
        """Three days waiting on a citizen's photo is not three days of officer time.

        Without the pause, 90 h of a 100 h target is DELAYED. With 40 h of it
        parked in NEEDS_MORE_EVIDENCE, only 50 h counted and it is ON_TIME.
        """
        assert sla.label(100, START, 0, None, at(90)) is SlaLabel.DELAYED
        assert sla.label(100, START, 40 * 3600, None, at(90)) is SlaLabel.ON_TIME


class TestClockWrites:
    def test_start_snapshots_the_categorys_current_target(self):
        assert sla.start(START, 48) == (48, START)

    def test_pause_is_a_noop_before_the_clock_starts(self):
        """The pre-acceptance NEEDS_MORE_EVIDENCE loop has nothing to pause."""
        assert sla.pause(None, at(2)) is None

    def test_pause_records_the_moment_once_the_clock_is_running(self):
        assert sla.pause(START, at(2)) == at(2)

    def test_resume_folds_the_open_pause_into_the_accumulator(self):
        paused_seconds, paused_at = sla.resume(3600, at(2), at(5))
        assert paused_seconds == 3600 + 3 * 3600
        assert paused_at is None

    def test_resume_without_an_open_pause_changes_nothing(self):
        assert sla.resume(3600, None, at(5)) == (3600, None)

    def test_backfill_is_needed_only_when_the_clock_never_started(self):
        assert sla.needs_backfill(None, None)
        assert sla.needs_backfill(24, None)
        assert not sla.needs_backfill(24, START)


class TestResolutionHours:
    def test_measures_acceptance_to_resolution_minus_pauses(self):
        assert sla.resolution_hours(at(10), START, 2 * 3600) == 8.0

    def test_none_when_never_resolved_or_never_accepted(self):
        assert sla.resolution_hours(None, START, 0) is None
        assert sla.resolution_hours(at(10), None, 0) is None

    def test_average_skips_incomplete_samples(self):
        assert sla.average_resolution_hours([4.0, None, 8.0]) == 6.0

    def test_empty_sample_is_none_not_zero(self):
        """ "Nothing resolved yet" must not be readable as "resolved instantly"."""
        assert sla.average_resolution_hours([]) is None
        assert sla.average_resolution_hours([None, None]) is None
