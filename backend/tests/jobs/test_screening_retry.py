"""The AI screening retry sweeper.

Without it, screening that does not land is permanent. Two ways that happens:

  * the provider returns nothing (down, no key, or the circuit breaker open
    after a burst of rate limiting) and the row is left UNAVAILABLE forever;
  * the fire-and-forget task dies with its process mid-flight and the row is
    left PENDING forever, with nothing that ever looks at it again.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.domain.enums import AiScreenStatus, ComplaintStatus, UserRole
from app.jobs.screening import sweep_screening_retries
from app.models import Complaint, ComplaintCategory, ComplaintEvidence, User, Zone
from app.models.base import utcnow
from app.services.accounts.auth import hash_password


@pytest.fixture
def retry_app(seeded_app):
    seeded_app.config.update(
        AI_SCREENING_ENABLED=True,
        AI_SCREENING_RETRY_WINDOW_HOURS=24,
        AI_SCREENING_RETRY_BATCH=25,
        AI_SCREENING_STALE_PENDING_MINUTES=60,
    )
    return seeded_app


@pytest.fixture
def complaint(retry_app, session):
    zone = session.query(Zone).filter_by(is_catch_all=True).one()
    category = session.query(ComplaintCategory).order_by(ComplaintCategory.id).first()
    citizen = User(
        full_name="Citizen",
        email="citizen@retry.example.com",
        password_hash=hash_password("password123"),
        role=UserRole.CITIZEN,
        zone_id=zone.id,
    )
    session.add(citizen)
    session.commit()

    row = Complaint(
        complaint_code="RETRY-1",
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        latitude=12.9,
        longitude=77.6,
        status=ComplaintStatus.SUBMITTED,
        severity_score=0,
        sla_paused_seconds=0,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    session.add(row)
    session.commit()
    return row


def add_evidence(session, complaint, *, status, age):
    """One evidence row in a given screening state, created `age` ago.

    `sequence` is unique per complaint, so it is derived rather than fixed —
    several rows on one complaint is exactly the burst case worth testing.
    """
    used = session.query(ComplaintEvidence).filter_by(complaint_id=complaint.id).count()
    evidence = ComplaintEvidence(
        complaint_id=complaint.id,
        sequence=used + 1,
        file_path="1/photo.jpg",
        ai_screen_status=status,
        created_at=utcnow() - age,
    )
    session.add(evidence)
    session.commit()
    return evidence


@pytest.fixture(autouse=True)
def captured_submissions(monkeypatch):
    """Record what the sweeper queues instead of running real screening."""
    submitted: list[int] = []
    monkeypatch.setattr(
        "app.jobs.screening.submit_evidence_screening",
        lambda app, ids: submitted.extend(ids),
    )
    return submitted


def test_unavailable_row_is_reset_to_pending_and_requeued(
    retry_app, session, complaint, captured_submissions
):
    evidence = add_evidence(
        session, complaint, status=AiScreenStatus.UNAVAILABLE, age=timedelta(minutes=30)
    )

    assert sweep_screening_retries(retry_app) == 1

    session.expire_all()
    # Back to PENDING, because screen_evidence deliberately only screens PENDING
    # rows — that guard is what stops a DONE verdict being overwritten.
    assert session.get(ComplaintEvidence, evidence.id).ai_screen_status is AiScreenStatus.PENDING
    assert captured_submissions == [evidence.id]


def test_stale_pending_row_is_requeued_without_a_status_change(
    retry_app, session, complaint, captured_submissions
):
    """A task that died with its process leaves the row PENDING forever."""
    evidence = add_evidence(
        session, complaint, status=AiScreenStatus.PENDING, age=timedelta(hours=3)
    )

    assert sweep_screening_retries(retry_app) == 1

    session.expire_all()
    assert session.get(ComplaintEvidence, evidence.id).ai_screen_status is AiScreenStatus.PENDING
    assert captured_submissions == [evidence.id]


def test_recently_pending_row_is_left_alone(
    retry_app, session, complaint, captured_submissions
):
    """A screening call genuinely in flight must not be duplicated."""
    add_evidence(session, complaint, status=AiScreenStatus.PENDING, age=timedelta(minutes=1))

    assert sweep_screening_retries(retry_app) == 0
    assert captured_submissions == []


def test_done_rows_are_never_touched(retry_app, session, complaint, captured_submissions):
    """Re-screening a finished row would overwrite a real verdict."""
    evidence = add_evidence(
        session, complaint, status=AiScreenStatus.DONE, age=timedelta(hours=2)
    )
    session.get(ComplaintEvidence, evidence.id).ai_note = "matches the category"
    session.commit()

    assert sweep_screening_retries(retry_app) == 0

    session.expire_all()
    refreshed = session.get(ComplaintEvidence, evidence.id)
    assert refreshed.ai_screen_status is AiScreenStatus.DONE
    assert refreshed.ai_note == "matches the category"


def test_rows_past_the_retry_window_are_abandoned(
    retry_app, session, complaint, captured_submissions
):
    """The bound: a genuinely dead provider must not be retried forever."""
    evidence = add_evidence(
        session, complaint, status=AiScreenStatus.UNAVAILABLE, age=timedelta(hours=48)
    )

    assert sweep_screening_retries(retry_app) == 0

    session.expire_all()
    assert (
        session.get(ComplaintEvidence, evidence.id).ai_screen_status
        is AiScreenStatus.UNAVAILABLE
    )
    assert captured_submissions == []


def test_one_sweep_is_capped_so_a_burst_cannot_flood_the_provider(
    retry_app, session, complaint, captured_submissions
):
    retry_app.config["AI_SCREENING_RETRY_BATCH"] = 3
    for _ in range(7):
        add_evidence(
            session,
            complaint,
            status=AiScreenStatus.UNAVAILABLE,
            age=timedelta(minutes=30),
        )

    assert sweep_screening_retries(retry_app) == 3
    assert len(captured_submissions) == 3


def test_sweeper_is_a_no_op_when_screening_is_disabled(
    retry_app, session, complaint, captured_submissions
):
    retry_app.config["AI_SCREENING_ENABLED"] = False
    add_evidence(
        session, complaint, status=AiScreenStatus.UNAVAILABLE, age=timedelta(minutes=30)
    )

    assert sweep_screening_retries(retry_app) == 0
    assert captured_submissions == []


def test_a_second_sweep_does_not_requeue_a_row_the_first_already_claimed(
    retry_app, session, complaint, captured_submissions
):
    """The conditional UPDATE is the claim; rowcount decides, not a prior read."""
    evidence = add_evidence(
        session, complaint, status=AiScreenStatus.UNAVAILABLE, age=timedelta(minutes=30)
    )

    assert sweep_screening_retries(retry_app) == 1

    # Simulate the queued task landing, which is what a real retry does within
    # seconds. The row is no longer in either population.
    session.expire_all()
    session.get(ComplaintEvidence, evidence.id).ai_screen_status = AiScreenStatus.DONE
    session.commit()

    assert sweep_screening_retries(retry_app) == 0
    assert len(captured_submissions) == 1
