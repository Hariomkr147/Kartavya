"""Severity bands, points amounts, the cluster reward rule, and badge criteria."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app.domain import badges, points, severity
from app.domain.badges import BadgeCriteria, CitizenStats
from app.domain.enums import BadgeCriteriaType, PointsReason, SeverityLabel

pytestmark = pytest.mark.domain


class TestSeverity:
    def test_standalone_complaint_scores_its_upvotes_alone(self):
        assert severity.score(1, 0) == 0
        assert severity.score(1, 7) == 7

    def test_each_extra_distinct_reporter_is_worth_three(self):
        assert severity.score(3, 0) == 6
        assert severity.score(3, 4) == 10

    @pytest.mark.parametrize(
        ("score", "expected"),
        [
            (0, SeverityLabel.LOW),
            (4, SeverityLabel.LOW),
            (5, SeverityLabel.MEDIUM),
            (14, SeverityLabel.MEDIUM),
            (15, SeverityLabel.HIGH),
            (29, SeverityLabel.HIGH),
            (30, SeverityLabel.CRITICAL),
            (999, SeverityLabel.CRITICAL),
        ],
    )
    def test_band_boundaries(self, score, expected):
        assert severity.label(score) is expected

    @pytest.mark.parametrize("band", list(SeverityLabel))
    def test_score_range_agrees_with_the_label_function(self, band):
        """The filter ranges and the read-time labels must not drift apart."""
        low, high = severity.score_range(band)
        assert severity.label(low) is band
        if high is not None:
            assert severity.label(high) is band
            assert severity.label(high + 1) is not band


class TestPoints:
    def test_amounts_match_the_contract(self):
        assert points.amount(PointsReason.COMPLAINT_CLOSED) == 50
        assert points.amount(PointsReason.CLUSTER_MEMBER_CLOSED) == 10
        assert points.amount(PointsReason.FIRST_COMPLAINT) == 10
        assert points.amount(PointsReason.ON_TIME_BONUS) == 15
        assert points.amount(PointsReason.UPVOTE_RECEIVED) == 5
        assert points.amount(PointsReason.REJECTED_PENALTY) == -20

    def test_standalone_confirm_always_pays_the_full_fifty(self):
        assert (
            points.close_reward(
                is_clustered=False,
                cluster_reward_already_granted=False,
                citizen_already_rewarded_in_cluster=False,
            )
            is PointsReason.COMPLAINT_CLOSED
        )

    def test_first_in_a_cluster_to_confirm_takes_the_fifty(self):
        assert (
            points.close_reward(
                is_clustered=True,
                cluster_reward_already_granted=False,
                citizen_already_rewarded_in_cluster=False,
            )
            is PointsReason.COMPLAINT_CLOSED
        )

    def test_later_cluster_members_get_ten(self):
        assert (
            points.close_reward(
                is_clustered=True,
                cluster_reward_already_granted=True,
                citizen_already_rewarded_in_cluster=False,
            )
            is PointsReason.CLUSTER_MEMBER_CLOSED
        )

    def test_a_citizen_is_paid_at_most_once_per_cluster(self):
        """Filing three complaints that get clustered together cannot farm rewards."""
        assert (
            points.close_reward(
                is_clustered=True,
                cluster_reward_already_granted=True,
                citizen_already_rewarded_in_cluster=True,
            )
            is None
        )

    def test_on_time_bonus_is_independent_of_the_cluster_reward(self):
        assert points.earns_on_time_bonus("ON_TIME")
        assert not points.earns_on_time_bonus("DELAYED")
        assert not points.earns_on_time_bonus(None)


class TestBadges:
    def test_first_complaint(self):
        criteria = BadgeCriteria(BadgeCriteriaType.FIRST_COMPLAINT)
        assert not badges.is_earned(criteria, CitizenStats(complaints_filed=0))
        assert badges.is_earned(criteria, CitizenStats(complaints_filed=1))

    def test_threshold_criteria_are_inclusive(self):
        criteria = BadgeCriteria(BadgeCriteriaType.LIFETIME_POINTS, criteria_value=100)
        assert not badges.is_earned(criteria, CitizenStats(lifetime_points=99))
        assert badges.is_earned(criteria, CitizenStats(lifetime_points=100))

    def test_a_missing_threshold_is_unearnable_not_always_earned(self):
        """A null criteria_value is a seed bug. Awarding it to everyone is worse."""
        criteria = BadgeCriteria(BadgeCriteriaType.COMPLAINTS_CLOSED, criteria_value=None)
        assert not badges.is_earned(criteria, CitizenStats(complaints_closed=1000))

    def test_closed_within_days_uses_a_rolling_window(self):
        base = datetime(2026, 7, 1)
        criteria = BadgeCriteria(
            BadgeCriteriaType.CLOSED_WITHIN_DAYS, criteria_value=7, criteria_count=3
        )

        # Three closures spread over 20 days: no 7-day window holds all three.
        spread = CitizenStats(
            closed_at_timestamps=[base, base + timedelta(days=10), base + timedelta(days=20)]
        )
        assert not badges.is_earned(criteria, spread)

        # Three inside one week.
        tight = CitizenStats(
            closed_at_timestamps=[base, base + timedelta(days=3), base + timedelta(days=6)]
        )
        assert badges.is_earned(criteria, tight)

    def test_closed_within_days_finds_a_window_that_is_not_at_the_start(self):
        base = datetime(2026, 7, 1)
        criteria = BadgeCriteria(
            BadgeCriteriaType.CLOSED_WITHIN_DAYS, criteria_value=7, criteria_count=3
        )
        stats = CitizenStats(
            closed_at_timestamps=[
                base,
                base + timedelta(days=30),
                base + timedelta(days=31),
                base + timedelta(days=32),
            ]
        )
        assert badges.is_earned(criteria, stats)

    def test_unsorted_timestamps_still_work(self):
        base = datetime(2026, 7, 1)
        criteria = BadgeCriteria(
            BadgeCriteriaType.CLOSED_WITHIN_DAYS, criteria_value=7, criteria_count=3
        )
        stats = CitizenStats(
            closed_at_timestamps=[
                base + timedelta(days=6),
                base,
                base + timedelta(days=3),
            ]
        )
        assert badges.is_earned(criteria, stats)
