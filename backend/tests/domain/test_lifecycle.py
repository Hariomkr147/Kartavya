"""Transition rules. No database, no app context — these run in milliseconds.

This file is the worked example for the rest of `tests/domain/`. Most of the
project's tests should end up here: every legal transition, every illegal one,
and every boundary of every band.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from app.domain import lifecycle
from app.domain.enums import (
    ComplaintStatus as S,
    EvidenceVerdict,
    OfficerTargetStatus as T,
    TransitionFailureCode,
)
from app.domain.errors import Err, Ok

pytestmark = pytest.mark.domain

NOW = datetime(2026, 7, 27, 12, 0, 0)


class TestOfficerTransitions:
    @pytest.mark.parametrize(
        ("current", "target"),
        [
            (S.UNDER_REVIEW, T.IN_PROGRESS),
            (S.IN_PROGRESS, T.UNDER_RESOLUTION),
            (S.UNDER_RESOLUTION, T.RESOLVED),
            (S.UNDER_REVIEW, T.UNRESOLVABLE),
            (S.IN_PROGRESS, T.UNRESOLVABLE),
            (S.UNDER_RESOLUTION, T.UNRESOLVABLE),
            (S.UNDER_REVIEW, T.NEEDS_MORE_EVIDENCE),
        ],
    )
    def test_legal_moves_are_allowed(self, current, target):
        reason = "because" if target in lifecycle.REASON_REQUIRED else None
        assert isinstance(lifecycle.validate_officer_transition(current, target, reason), Ok)

    @pytest.mark.parametrize(
        ("current", "target"),
        [
            (S.SUBMITTED, T.IN_PROGRESS),  # must be claimed and reviewed first
            (S.UNDER_REVIEW, T.RESOLVED),  # no skipping the working stages
            (S.CLOSED, T.IN_PROGRESS),  # terminal
            (S.REJECTED, T.IN_PROGRESS),  # terminal
            (S.UNRESOLVABLE, T.IN_PROGRESS),  # terminal
        ],
    )
    def test_illegal_moves_are_refused(self, current, target):
        result = lifecycle.validate_officer_transition(current, target, "reason")
        assert isinstance(result, Err)
        assert result.code == TransitionFailureCode.INVALID_TRANSITION

    @pytest.mark.parametrize("target", [T.IN_PROGRESS, T.UNDER_RESOLUTION, T.RESOLVED])
    def test_reopened_is_never_an_officer_source(self, target):
        """REOPENED has exactly one exit and it belongs to the admin.

        Not the status door, not the batch door, not the cascade — a pending
        dispute must never be swept aside before an admin has ruled on it.
        """
        result = lifecycle.validate_officer_transition(S.REOPENED, target, "reason")
        assert isinstance(result, Err)

    @pytest.mark.parametrize("target", [T.UNRESOLVABLE, T.NEEDS_MORE_EVIDENCE])
    @pytest.mark.parametrize("reason", [None, "", "   "])
    def test_reason_is_required_and_whitespace_is_not_a_reason(self, target, reason):
        current = S.UNDER_REVIEW
        result = lifecycle.validate_officer_transition(current, target, reason)
        assert isinstance(result, Err)
        assert result.code == TransitionFailureCode.REASON_REQUIRED
        assert result.http_status == 400


class TestEvidenceReview:
    def test_valid_verdict_needs_no_reason(self):
        result = lifecycle.validate_evidence_review(
            S.EVIDENCE_UNDER_REVIEW, None, EvidenceVerdict.VALID, None
        )
        assert isinstance(result, Ok)

    def test_rejected_is_legal_on_the_first_round(self):
        result = lifecycle.validate_evidence_review(
            S.EVIDENCE_UNDER_REVIEW, None, EvidenceVerdict.REJECTED, "fake photo"
        )
        assert isinstance(result, Ok)

    def test_rejected_is_illegal_once_the_clock_has_started(self):
        """An already-accepted complaint can be recalled, but never declared fake.

        It was validated once and may be actively being worked; rejecting it now
        would be a false accusation carrying a real -20 point penalty.
        """
        result = lifecycle.validate_evidence_review(
            S.EVIDENCE_UNDER_REVIEW, NOW, EvidenceVerdict.REJECTED, "changed my mind"
        )
        assert isinstance(result, Err)
        assert result.http_status == 409

    def test_needs_more_evidence_stays_legal_on_a_later_round(self):
        result = lifecycle.validate_evidence_review(
            S.EVIDENCE_UNDER_REVIEW, NOW, EvidenceVerdict.NEEDS_MORE_EVIDENCE, "too dark"
        )
        assert isinstance(result, Ok)

    @pytest.mark.parametrize(
        "verdict", [EvidenceVerdict.NEEDS_MORE_EVIDENCE, EvidenceVerdict.REJECTED]
    )
    def test_negative_verdicts_require_a_reason(self, verdict):
        result = lifecycle.validate_evidence_review(
            S.EVIDENCE_UNDER_REVIEW, None, verdict, None
        )
        assert isinstance(result, Err)
        assert result.http_status == 400

    def test_wrong_stage_is_a_conflict(self):
        result = lifecycle.validate_evidence_review(
            S.IN_PROGRESS, None, EvidenceVerdict.VALID, None
        )
        assert isinstance(result, Err)
        assert result.http_status == 409


class TestCitizenAndAdminDoors:
    def test_confirm_requires_resolved(self):
        assert isinstance(lifecycle.validate_confirm(S.RESOLVED), Ok)
        assert isinstance(lifecycle.validate_confirm(S.IN_PROGRESS), Err)

    def test_dispute_requires_resolved_a_reason_and_a_photo(self):
        assert isinstance(lifecycle.validate_dispute(S.RESOLVED, "still broken", True), Ok)
        assert isinstance(lifecycle.validate_dispute(S.RESOLVED, "still broken", False), Err)
        assert isinstance(lifecycle.validate_dispute(S.RESOLVED, "", True), Err)
        assert isinstance(lifecycle.validate_dispute(S.CLOSED, "still broken", True), Err)

    def test_dispute_review_only_exits_reopened(self):
        assert isinstance(lifecycle.validate_dispute_review(S.REOPENED), Ok)
        assert isinstance(lifecycle.validate_dispute_review(S.RESOLVED), Err)

    def test_claim_only_from_submitted(self):
        assert isinstance(lifecycle.validate_claim(S.SUBMITTED), Ok)
        assert isinstance(lifecycle.validate_claim(S.EVIDENCE_UNDER_REVIEW), Err)


class TestCascadeEligibility:
    @pytest.mark.parametrize(
        "status", [S.UNDER_REVIEW, S.IN_PROGRESS, S.UNDER_RESOLUTION]
    )
    def test_working_stages_cascade(self, status):
        assert lifecycle.is_cascade_eligible(status)

    @pytest.mark.parametrize(
        "status",
        [
            S.SUBMITTED,  # the evidence gate is never bypassed by riding a cluster
            S.EVIDENCE_UNDER_REVIEW,
            S.NEEDS_MORE_EVIDENCE,
            S.REOPENED,  # a pending dispute always waits for its admin
            S.RESOLVED,
            S.CLOSED,
            S.REJECTED,
            S.UNRESOLVABLE,
        ],
    )
    def test_everything_else_is_skipped(self, status):
        assert not lifecycle.is_cascade_eligible(status)


def test_terminal_set_is_exactly_three():
    assert lifecycle.TERMINAL == {S.REJECTED, S.CLOSED, S.UNRESOLVABLE}
