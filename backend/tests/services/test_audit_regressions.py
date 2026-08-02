"""Regressions for defects found auditing `feat/backend-integration`.

Each test names the bug it locks down. They live at the service layer because
that is where every one of these actually went wrong — the routes were fine.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.domain.enums import (
    ComplaintStatus,
    EvidenceVerdict,
    OfficerTargetStatus,
    PointsReason,
    StatusActor,
    UserRole,
)
from app.models import (
    Complaint,
    ComplaintCategory,
    ComplaintCluster,
    ComplaintEvidence,
    PointsLedger,
    StatusHistory,
    User,
    Zone,
)
from app.services.accounts.auth import hash_password

API = "/api/v1"


def now():
    return datetime.now(UTC).replace(tzinfo=None)


@pytest.fixture
def world(seeded_app, session):
    zone = session.query(Zone).filter_by(is_catch_all=True).one()
    category = session.query(ComplaintCategory).order_by(ComplaintCategory.id).first()
    officer = User(
        full_name="Officer",
        email="officer@regression.example.com",
        password_hash=hash_password("password123"),
        role=UserRole.OFFICER,
        zone_id=zone.id,
    )
    citizen = User(
        full_name="Citizen",
        email="citizen@regression.example.com",
        password_hash=hash_password("password123"),
        role=UserRole.CITIZEN,
        zone_id=zone.id,
    )
    admin = session.query(User).filter_by(role=UserRole.ADMIN).first()
    session.add_all([officer, citizen])
    session.commit()
    return zone, category, officer, citizen, admin


def make_complaint(session, *, citizen, zone, category, status, code, cluster_id=None):
    complaint = Complaint(
        complaint_code=code,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        cluster_id=cluster_id,
        latitude=12.9,
        longitude=77.6,
        status=status,
        severity_score=0,
        sla_paused_seconds=0,
        created_at=now(),
        updated_at=now(),
    )
    session.add(complaint)
    session.commit()
    return complaint


# --- The blocker: REJECTED evidence review 500'd on an ImportError -------------


def test_rejected_verdict_applies_the_penalty_instead_of_crashing(seeded_app, session, world):
    """`ledger.award_points` never existed; the whole verdict raised ImportError.

    One of the contract's three verdicts was unreachable and the -20 CSP penalty
    was never credited, because the failing request rolled back.
    """
    from app.services.complaints.lifecycle import review_evidence

    zone, category, officer, citizen, _admin = world
    complaint = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category=category,
        status=ComplaintStatus.EVIDENCE_UNDER_REVIEW,
        code="REJ-1",
    )
    session.add(
        ComplaintEvidence(
            complaint_id=complaint.id, sequence=1, file_path="1/a.jpg", created_at=now()
        )
    )
    session.commit()

    detail = review_evidence(
        complaint_id=complaint.id,
        officer=officer,
        verdict=EvidenceVerdict.REJECTED,
        reason="Photo shows an unrelated location.",
        now=now(),
    )

    assert detail.complaint.status is ComplaintStatus.REJECTED
    penalty = session.query(PointsLedger).filter_by(
        citizen_id=citizen.id, reason=PointsReason.REJECTED_PENALTY
    ).one()
    assert penalty.points_change == -20
    assert penalty.complaint_id == complaint.id


def test_rejected_verdict_is_still_first_round_only(seeded_app, session, world):
    from app.domain.errors import ConflictError
    from app.services.complaints.lifecycle import review_evidence

    zone, category, officer, citizen, _admin = world
    complaint = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category=category,
        status=ComplaintStatus.EVIDENCE_UNDER_REVIEW,
        code="REJ-2",
    )
    complaint.sla_started_at = now()  # already accepted once
    session.commit()

    with pytest.raises(ConflictError):
        review_evidence(
            complaint_id=complaint.id,
            officer=officer,
            verdict=EvidenceVerdict.REJECTED,
            reason="Too late to call it fake.",
            now=now(),
        )
    assert session.query(PointsLedger).filter_by(reason=PointsReason.REJECTED_PENALTY).count() == 0


# --- The cascade reported the post-transition status as `previousStatus` -------


def test_cascade_reports_the_status_each_member_actually_held(seeded_app, session, world):
    """`apply_transition` refreshes the instance, so reading after it lies.

    Every CASCADED entry came back with previousStatus RESOLVED — the value it
    had just been set to — making the officer's cascade summary useless.
    """
    from app.services.complaints.lifecycle import transition_by_officer

    zone, category, officer, citizen, _admin = world
    cluster = ComplaintCluster(
        category_id=category.id,
        zone_id=zone.id,
        centroid_lat=12.9,
        centroid_lng=77.6,
        report_count=4,
        unique_reporter_count=4,
        created_at=now(),
        updated_at=now(),
    )
    session.add(cluster)
    session.commit()

    driver = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category=category,
        status=ComplaintStatus.UNDER_RESOLUTION,
        code="CAS-DRIVER",
        cluster_id=cluster.id,
    )
    eligible = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category=category,
        status=ComplaintStatus.IN_PROGRESS,
        code="CAS-ELIGIBLE",
        cluster_id=cluster.id,
    )
    disputed = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category=category,
        status=ComplaintStatus.REOPENED,
        code="CAS-REOPENED",
        cluster_id=cluster.id,
    )

    result = transition_by_officer(
        complaint_id=driver.id,
        officer=officer,
        target=OfficerTargetStatus.RESOLVED,
        reason=None,
        note=None,
        now=now(),
    )

    by_id = {entry["complaintId"]: entry for entry in result.cascade}
    assert by_id[str(eligible.id)] == {
        "complaintId": str(eligible.id),
        "outcome": "CASCADED",
        "previousStatus": "IN_PROGRESS",
    }
    # A pending dispute is never swept along, and reports its real status.
    assert by_id[str(disputed.id)] == {
        "complaintId": str(disputed.id),
        "outcome": "SKIPPED",
        "previousStatus": "REOPENED",
    }
    assert session.get(Complaint, disputed.id).status is ComplaintStatus.REOPENED


def test_cascaded_members_get_a_system_history_row(seeded_app, session, world):
    from app.services.complaints.lifecycle import transition_by_officer

    zone, category, officer, citizen, _admin = world
    cluster = ComplaintCluster(
        category_id=category.id,
        zone_id=zone.id,
        centroid_lat=12.9,
        centroid_lng=77.6,
        report_count=2,
        unique_reporter_count=2,
        created_at=now(),
        updated_at=now(),
    )
    session.add(cluster)
    session.commit()
    driver = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category=category,
        status=ComplaintStatus.UNDER_RESOLUTION,
        code="SYS-1",
        cluster_id=cluster.id,
    )
    sibling = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category=category,
        status=ComplaintStatus.UNDER_REVIEW,
        code="SYS-2",
        cluster_id=cluster.id,
    )

    transition_by_officer(
        complaint_id=driver.id,
        officer=officer,
        target=OfficerTargetStatus.RESOLVED,
        reason=None,
        note=None,
        now=now(),
    )

    entry = (
        session.query(StatusHistory)
        .filter_by(complaint_id=sibling.id, to_status=ComplaintStatus.RESOLVED)
        .one()
    )
    assert entry.actor_role is StatusActor.SYSTEM
    assert entry.changed_by_user_id is None
    assert entry.from_status is ComplaintStatus.UNDER_REVIEW


# --- ZoneSummary was missing two contract fields ------------------------------


def test_zone_summary_counts_clusters_and_treats_closed_as_resolved(
    seeded_app, session, world
):
    from app.services.analytics.zone import zone_summary

    zone, category, _officer, citizen, _admin = world
    cluster = ComplaintCluster(
        category_id=category.id,
        zone_id=zone.id,
        centroid_lat=12.9,
        centroid_lng=77.6,
        report_count=2,
        unique_reporter_count=1,
        created_at=now(),
        updated_at=now(),
    )
    session.add(cluster)
    session.commit()

    make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category=category,
        status=ComplaintStatus.IN_PROGRESS,
        code="ZS-ACTIVE",
        cluster_id=cluster.id,
    )
    make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category=category,
        status=ComplaintStatus.CLOSED,
        code="ZS-CLOSED",
        cluster_id=cluster.id,
    )
    make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category=category,
        status=ComplaintStatus.RESOLVED,
        code="ZS-RESOLVED",
    )

    summary = zone_summary(zone_id=zone.id)
    assert summary["totalComplaints"] == 3
    assert summary["activeComplaints"] == 2  # IN_PROGRESS + RESOLVED
    assert summary["resolvedComplaints"] == 2  # RESOLVED + CLOSED
    assert summary["totalClusters"] == 1
    assert summary["activeClusters"] == 1


# --- Admin override: a reason on its own is a legitimate annotation ------------


def test_reason_only_override_is_recorded_rather_than_rejected(seeded_app, session, world):
    from app.services.complaints.lifecycle import override

    zone, category, _officer, citizen, admin = world
    complaint = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category=category,
        status=ComplaintStatus.IN_PROGRESS,
        code="OVR-1",
    )

    override(
        complaint_id=complaint.id,
        admin=admin,
        new_status=None,
        new_zone_id=None,
        new_category_id=None,
        reason="Escalated after a councillor's query.",
        now=now(),
        cluster_radius_meters=100.0,
    )

    entry = (
        session.query(StatusHistory)
        .filter_by(complaint_id=complaint.id)
        .order_by(StatusHistory.id.desc())
        .first()
    )
    assert entry.actor_role is StatusActor.ADMIN
    assert entry.reason == "Escalated after a councillor's query."
    assert session.get(Complaint, complaint.id).status is ComplaintStatus.IN_PROGRESS


def test_empty_override_is_still_a_validation_error(seeded_app, session, world):
    from app.domain.errors import ValidationError
    from app.services.complaints.lifecycle import override

    zone, category, _officer, citizen, admin = world
    complaint = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category=category,
        status=ComplaintStatus.IN_PROGRESS,
        code="OVR-2",
    )
    with pytest.raises(ValidationError):
        override(
            complaint_id=complaint.id,
            admin=admin,
            new_status=None,
            new_zone_id=None,
            new_category_id=None,
            reason="   ",
            now=now(),
            cluster_radius_meters=100.0,
        )


# --- Photo route: a missing row must answer 403, never 404 --------------------


def test_missing_evidence_is_indistinguishable_from_a_bad_signature(
    seeded_app, client, session, world
):
    from app.core.signing import sign_photo_url

    zone, category, _officer, citizen, _admin = world
    complaint = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category=category,
        status=ComplaintStatus.SUBMITTED,
        code="PH-1",
    )
    evidence = ComplaintEvidence(
        complaint_id=complaint.id, sequence=1, file_path="missing/nope.jpg", created_at=now()
    )
    session.add(evidence)
    session.commit()

    # A valid signature over a row whose FILE is gone.
    valid_link_missing_file = sign_photo_url(evidence.id)
    assert client.get(valid_link_missing_file).status_code == 403

    # A valid signature over a row that does not exist at all.
    assert client.get(sign_photo_url(999_999)).status_code == 403
