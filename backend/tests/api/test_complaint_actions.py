from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from io import BytesIO
from threading import Barrier

import pytest
from sqlalchemy import func, select

from app.domain.enums import AiScreenStatus, ComplaintStatus, PointsReason, UserRole
from app.models import (
    CitizenBadge,
    Complaint,
    ComplaintCluster,
    ComplaintEvidence,
    ComplaintUpvote,
    PointsLedger,
    StatusHistory,
    User,
    Zone,
)
from app.services.accounts.auth import hash_password
from app.settings import API_PREFIX


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _png_file(name: str = "photo.png"):
    return (BytesIO(b"\x89PNG\r\n\x1a\nexample-payload"), name)


def _jpeg_file(name: str = "photo.jpg"):
    return (BytesIO(b"\xff\xd8\xffexample-payload"), name)


def _oversized_png(max_bytes: int, name: str = "oversized.png"):
    return (BytesIO(b"\x89PNG\r\n\x1a\n" + b"x" * max_bytes), name)


def _create_user(session, *, email: str, role: UserRole, zone_id: int | None) -> User:
    user = User(
        full_name=email.split("@")[0].title(),
        display_name=None,
        email=email,
        password_hash=hash_password("password123"),
        role=role,
        zone_id=zone_id,
        is_active=True,
    )
    session.add(user)
    session.flush()
    return user


def _create_complaint(
    session,
    *,
    citizen_id: int,
    zone_id: int,
    category_id: int,
    complaint_code: str,
    status: ComplaintStatus,
    sla_started_at: datetime | None = None,
    sla_target_hours: int | None = None,
    sla_paused_at: datetime | None = None,
    sla_paused_seconds: int = 0,
    cluster_id: int | None = None,
) -> Complaint:
    now = _utcnow()
    complaint = Complaint(
        complaint_code=complaint_code,
        citizen_id=citizen_id,
        zone_id=zone_id,
        category_id=category_id,
        cluster_id=cluster_id,
        description="Broken road",
        category_suggested_by_matcher=False,
        latitude=12.0,
        longitude=77.0,
        status=status,
        severity_score=0,
        sla_started_at=sla_started_at,
        sla_target_hours=sla_target_hours,
        sla_paused_at=sla_paused_at,
        sla_paused_seconds=sla_paused_seconds,
        updated_at=now,
        resolved_at=now if status is ComplaintStatus.RESOLVED else None,
    )
    session.add(complaint)
    session.flush()
    session.add(
        ComplaintEvidence(
            complaint_id=complaint.id,
            sequence=1,
            file_path=f"{complaint.id}/seed.png",
            ai_screen_status=AiScreenStatus.PENDING,
            created_at=now,
        )
    )
    session.flush()
    return complaint


def _base_entities(session):
    from app.models import ComplaintCategory, Zone

    zone = session.execute(select(Zone).where(Zone.is_catch_all.is_(True))).scalar_one()
    category = session.execute(select(ComplaintCategory)).scalars().first()
    assert category is not None
    citizen = _create_user(
        session, email="citizen@example.com", role=UserRole.CITIZEN, zone_id=zone.id
    )
    other_citizen = _create_user(
        session,
        email="other@example.com",
        role=UserRole.CITIZEN,
        zone_id=zone.id,
    )
    session.commit()
    return zone, category, citizen, other_citizen


def _file_backed_app(tmp_path):
    """A SQLite file gives concurrent requests independent connections."""
    from app import create_app
    from app.extensions import db
    from app.seed import seed_all
    from app.settings import TestingConfig

    config = TestingConfig()
    config.SQLALCHEMY_DATABASE_URI = f"sqlite:///{(tmp_path / 'race.sqlite3').as_posix()}"
    config.UPLOAD_DIR = tmp_path / "uploads"
    app = create_app(config)
    with app.app_context():
        db.create_all()
        seed_all()
    return app


def _auth_for(app, user):
    from app.core.auth import issue_token

    with app.app_context():
        token, _ = issue_token(user)
    return {"Authorization": f"Bearer {token}"}


def test_submit_additional_evidence_success(seeded_app, session, auth_header):
    client = seeded_app.test_client()
    zone, category, citizen, _ = _base_entities(session)
    paused_at = _utcnow() - timedelta(minutes=30)
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000101",
        status=ComplaintStatus.NEEDS_MORE_EVIDENCE,
        sla_started_at=_utcnow() - timedelta(hours=2),
        sla_target_hours=24,
        sla_paused_at=paused_at,
    )
    session.commit()

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/evidence",
        headers=auth_header(citizen),
        data={"photo": _png_file()},
        content_type="multipart/form-data",
    )

    assert response.status_code == 201
    body = response.get_json()
    assert body["status"] == "EVIDENCE_UNDER_REVIEW"
    assert len(body["evidence"]) == 2
    refreshed = session.get(Complaint, complaint.id)
    assert refreshed is not None
    assert refreshed.status is ComplaintStatus.EVIDENCE_UNDER_REVIEW
    assert refreshed.sla_paused_at is None
    assert refreshed.sla_paused_seconds > 0
    evidence = (
        session.execute(
            select(ComplaintEvidence)
            .where(ComplaintEvidence.complaint_id == complaint.id)
            .order_by(ComplaintEvidence.sequence)
        )
        .scalars()
        .all()
    )
    assert [row.sequence for row in evidence] == [1, 2]
    assert evidence[-1].ai_screen_status is AiScreenStatus.PENDING
    assert (
        session.execute(
            select(func.count(StatusHistory.id)).where(
                StatusHistory.complaint_id == complaint.id,
                StatusHistory.to_status == ComplaintStatus.EVIDENCE_UNDER_REVIEW,
            )
        ).scalar_one()
        == 1
    )


def test_submit_additional_evidence_rejects_wrong_status(seeded_app, session, auth_header):
    client = seeded_app.test_client()
    zone, category, citizen, _ = _base_entities(session)
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000102",
        status=ComplaintStatus.SUBMITTED,
    )
    session.commit()

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/evidence",
        headers=auth_header(citizen),
        data={"photo": _png_file()},
        content_type="multipart/form-data",
    )

    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "INVALID_TRANSITION"


def test_submit_additional_evidence_rejects_invalid_photo_without_transition(
    seeded_app, session, auth_header
):
    client = seeded_app.test_client()
    zone, category, citizen, _ = _base_entities(session)
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000102A",
        status=ComplaintStatus.NEEDS_MORE_EVIDENCE,
    )
    session.commit()

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/evidence",
        headers=auth_header(citizen),
        data={"photo": (BytesIO(b"not-an-image"), "photo.txt")},
        content_type="multipart/form-data",
    )

    assert response.status_code == 400
    assert session.get(Complaint, complaint.id).status is ComplaintStatus.NEEDS_MORE_EVIDENCE
    assert (
        session.execute(
            select(func.count(ComplaintEvidence.id)).where(
                ComplaintEvidence.complaint_id == complaint.id
            )
        ).scalar_one()
        == 1
    )


def test_submit_additional_evidence_requires_a_photo(seeded_app, session, auth_header):
    client = seeded_app.test_client()
    zone, category, citizen, _ = _base_entities(session)
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000102B",
        status=ComplaintStatus.NEEDS_MORE_EVIDENCE,
    )
    session.commit()

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/evidence",
        headers=auth_header(citizen),
        data={},
        content_type="multipart/form-data",
    )

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "VALIDATION_ERROR"
    assert session.get(Complaint, complaint.id).status is ComplaintStatus.NEEDS_MORE_EVIDENCE


def test_submit_additional_evidence_rejects_oversized_photo(
    seeded_app, session, auth_header
):
    client = seeded_app.test_client()
    zone, category, citizen, _ = _base_entities(session)
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000102C",
        status=ComplaintStatus.NEEDS_MORE_EVIDENCE,
    )
    session.commit()

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/evidence",
        headers=auth_header(citizen),
        data={"photo": _oversized_png(seeded_app.config["MAX_UPLOAD_BYTES"])},
        content_type="multipart/form-data",
    )

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "VALIDATION_ERROR"
    assert session.get(Complaint, complaint.id).status is ComplaintStatus.NEEDS_MORE_EVIDENCE
    assert (
        session.execute(
            select(func.count(ComplaintEvidence.id)).where(
                ComplaintEvidence.complaint_id == complaint.id
            )
        ).scalar_one()
        == 1
    )


def test_submit_additional_evidence_accepts_jpeg_and_leaves_unstarted_sla_unchanged(
    seeded_app, session, auth_header
):
    client = seeded_app.test_client()
    zone, category, citizen, _ = _base_entities(session)
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000102D",
        status=ComplaintStatus.NEEDS_MORE_EVIDENCE,
        sla_started_at=None,
        sla_target_hours=None,
        sla_paused_at=None,
        sla_paused_seconds=0,
    )
    session.commit()

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/evidence",
        headers=auth_header(citizen),
        data={"photo": _jpeg_file()},
        content_type="multipart/form-data",
    )

    assert response.status_code == 201
    refreshed = session.get(Complaint, complaint.id)
    assert refreshed.status is ComplaintStatus.EVIDENCE_UNDER_REVIEW
    assert refreshed.sla_started_at is None
    assert refreshed.sla_target_hours is None
    assert refreshed.sla_paused_at is None
    assert refreshed.sla_paused_seconds == 0


def test_concurrent_evidence_resubmission_returns_one_success_and_one_conflict(
    tmp_path, monkeypatch
):
    """Force both requests to reach the guarded transition together."""
    from app.extensions import db
    from app.services.complaints import submission as submission_service

    app = _file_backed_app(tmp_path)
    with app.app_context():
        zone, category, citizen, _ = _base_entities(db.session)
        complaint = _create_complaint(
            db.session,
            citizen_id=citizen.id,
            zone_id=zone.id,
            category_id=category.id,
            complaint_code="KTV-2026-000102E",
            status=ComplaintStatus.NEEDS_MORE_EVIDENCE,
        )
        db.session.commit()
        complaint_id = complaint.id
        headers = _auth_for(app, citizen)

    transition_barrier = Barrier(2)
    original_apply_transition = submission_service.apply_transition

    def synchronized_apply_transition(**kwargs):
        transition_barrier.wait()
        return original_apply_transition(**kwargs)

    monkeypatch.setattr(
        submission_service,
        "apply_transition",
        synchronized_apply_transition,
    )

    def submit(index):
        with app.test_client() as client:
            response = client.post(
                f"{API_PREFIX}/complaints/{complaint_id}/evidence",
                headers=headers,
                data={"photo": _png_file(f"evidence-{index}.png")},
                content_type="multipart/form-data",
            )
            return response.status_code, response.get_json()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(submit, range(2)))

    assert sorted(status for status, _ in results) == [201, 409]
    losing_body = next(body for status, body in results if status == 409)
    assert losing_body["error"]["code"] == "INVALID_TRANSITION"
    with app.app_context():
        assert (
            db.session.execute(
                select(func.count(ComplaintEvidence.id)).where(
                    ComplaintEvidence.complaint_id == complaint_id
                )
            ).scalar_one()
            == 2
        )
        assert (
            db.session.execute(
                select(func.count(StatusHistory.id)).where(
                    StatusHistory.complaint_id == complaint_id,
                    StatusHistory.to_status == ComplaintStatus.EVIDENCE_UNDER_REVIEW,
                )
            ).scalar_one()
            == 1
        )


def test_upvote_complaint_success(seeded_app, session, auth_header):
    client = seeded_app.test_client()
    zone, category, citizen, other_citizen = _base_entities(session)
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000103",
        status=ComplaintStatus.UNDER_REVIEW,
    )
    session.commit()

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/upvote",
        headers=auth_header(other_citizen),
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body == {
        "complaintId": str(complaint.id),
        "upvoteCount": 1,
        "severityLabel": "LOW",
    }
    ledger = (
        session.execute(select(PointsLedger).where(PointsLedger.complaint_id == complaint.id))
        .scalars()
        .all()
    )
    assert len(ledger) == 1
    assert ledger[0].reason is PointsReason.UPVOTE_RECEIVED
    assert ledger[0].points_change == 5
    assert (
        session.execute(
            select(func.count(CitizenBadge.id)).where(CitizenBadge.citizen_id == citizen.id)
        ).scalar_one()
        >= 1
    )


def test_upvote_complaint_rejects_repeat_vote(seeded_app, session, auth_header):
    client = seeded_app.test_client()
    zone, category, citizen, other_citizen = _base_entities(session)
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000104",
        status=ComplaintStatus.UNDER_REVIEW,
    )
    session.add(ComplaintUpvote(complaint_id=complaint.id, citizen_id=other_citizen.id))
    session.commit()

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/upvote",
        headers=auth_header(other_citizen),
    )

    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "ALREADY_UPVOTED"


def test_concurrent_upvote_creates_one_vote_and_one_reward(tmp_path):
    from app.extensions import db

    app = _file_backed_app(tmp_path)
    with app.app_context():
        zone, category, citizen, other_citizen = _base_entities(db.session)
        complaint = _create_complaint(
            db.session,
            citizen_id=citizen.id,
            zone_id=zone.id,
            category_id=category.id,
            complaint_code="KTV-2026-000108",
            status=ComplaintStatus.UNDER_REVIEW,
        )
        db.session.commit()
        complaint_id = complaint.id
        headers = _auth_for(app, other_citizen)

    start = Barrier(2)

    def vote():
        start.wait()
        with app.test_client() as client:
            return client.post(
                f"{API_PREFIX}/complaints/{complaint_id}/upvote",
                headers=headers,
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = sorted(executor.map(lambda _: vote(), range(2)))

    assert statuses == [200, 409]
    with app.app_context():
        assert (
            db.session.execute(
                select(func.count(ComplaintUpvote.id)).where(
                    ComplaintUpvote.complaint_id == complaint_id
                )
            ).scalar_one()
            == 1
        )
        assert (
            db.session.execute(
                select(func.count(PointsLedger.id)).where(
                    PointsLedger.complaint_id == complaint_id,
                    PointsLedger.reason == PointsReason.UPVOTE_RECEIVED,
                )
            ).scalar_one()
            == 1
        )


def test_upvote_rejects_self_vote_without_side_effects(seeded_app, session, auth_header):
    client = seeded_app.test_client()
    zone, category, citizen, _ = _base_entities(session)
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000109",
        status=ComplaintStatus.UNDER_REVIEW,
    )
    session.commit()

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/upvote",
        headers=auth_header(citizen),
    )

    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "FORBIDDEN"
    assert (
        session.execute(
            select(func.count(ComplaintUpvote.id)).where(
                ComplaintUpvote.complaint_id == complaint.id
            )
        ).scalar_one()
        == 0
    )
    assert (
        session.execute(
            select(func.count(PointsLedger.id)).where(PointsLedger.complaint_id == complaint.id)
        ).scalar_one()
        == 0
    )


def test_upvote_rejects_cross_zone_without_side_effects(seeded_app, session, auth_header):
    client = seeded_app.test_client()
    zone, category, citizen, _ = _base_entities(session)
    other_zone = Zone(
        zone_code="OTHER",
        zone_name="Other zone",
        center_lat=13.0,
        center_lng=78.0,
        is_catch_all=False,
        is_active=True,
    )
    session.add(other_zone)
    session.flush()
    outsider = _create_user(
        session,
        email="outsider@example.com",
        role=UserRole.CITIZEN,
        zone_id=other_zone.id,
    )
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000110",
        status=ComplaintStatus.UNDER_REVIEW,
    )
    session.commit()

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/upvote",
        headers=auth_header(outsider),
    )

    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "FORBIDDEN"
    assert (
        session.execute(
            select(func.count(ComplaintUpvote.id)).where(
                ComplaintUpvote.complaint_id == complaint.id
            )
        ).scalar_one()
        == 0
    )
    assert (
        session.execute(
            select(func.count(PointsLedger.id)).where(PointsLedger.complaint_id == complaint.id)
        ).scalar_one()
        == 0
    )


def test_upvote_rejects_closed_complaint_without_side_effects(seeded_app, session, auth_header):
    client = seeded_app.test_client()
    zone, category, citizen, other_citizen = _base_entities(session)
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000111",
        status=ComplaintStatus.CLOSED,
    )
    session.commit()

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/upvote",
        headers=auth_header(other_citizen),
    )

    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "ALREADY_CLOSED"
    assert (
        session.execute(
            select(func.count(ComplaintUpvote.id)).where(
                ComplaintUpvote.complaint_id == complaint.id
            )
        ).scalar_one()
        == 0
    )
    assert (
        session.execute(
            select(func.count(PointsLedger.id)).where(PointsLedger.complaint_id == complaint.id)
        ).scalar_one()
        == 0
    )


def test_confirm_resolution_success(seeded_app, session, auth_header):
    client = seeded_app.test_client()
    zone, category, citizen, _ = _base_entities(session)
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000105",
        status=ComplaintStatus.RESOLVED,
        sla_started_at=_utcnow() - timedelta(hours=100),
        sla_target_hours=24,
    )
    session.commit()

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/confirm",
        headers=auth_header(citizen),
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "CLOSED"
    refreshed = session.get(Complaint, complaint.id)
    assert refreshed is not None
    assert refreshed.status is ComplaintStatus.CLOSED
    assert refreshed.closed_at is not None
    ledger = (
        session.execute(select(PointsLedger).where(PointsLedger.complaint_id == complaint.id))
        .scalars()
        .all()
    )
    assert [row.reason for row in ledger] == [PointsReason.COMPLAINT_CLOSED]
    assert ledger[0].points_change == 50
    assert (
        session.execute(
            select(func.count(StatusHistory.id)).where(
                StatusHistory.complaint_id == complaint.id,
                StatusHistory.to_status == ComplaintStatus.CLOSED,
            )
        ).scalar_one()
        == 1
    )
    assert (
        session.execute(
            select(func.count(CitizenBadge.id)).where(CitizenBadge.citizen_id == citizen.id)
        ).scalar_one()
        >= 1
    )


def test_confirm_awards_on_time_bonus_independently(seeded_app, session, auth_header):
    client = seeded_app.test_client()
    zone, category, citizen, _ = _base_entities(session)
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000105A",
        status=ComplaintStatus.RESOLVED,
        sla_started_at=_utcnow() - timedelta(hours=1),
        sla_target_hours=24,
    )
    session.commit()

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/confirm",
        headers=auth_header(citizen),
    )

    assert response.status_code == 200
    reasons = set(
        session.execute(
            select(PointsLedger.reason).where(PointsLedger.complaint_id == complaint.id)
        ).scalars()
    )
    assert reasons == {
        PointsReason.COMPLAINT_CLOSED,
        PointsReason.ON_TIME_BONUS,
    }


def test_concurrent_confirm_allows_only_one_winner(tmp_path):
    from app.extensions import db

    app = _file_backed_app(tmp_path)
    with app.app_context():
        zone, category, citizen, _ = _base_entities(db.session)
        complaint = _create_complaint(
            db.session,
            citizen_id=citizen.id,
            zone_id=zone.id,
            category_id=category.id,
            complaint_code="KTV-2026-000112",
            status=ComplaintStatus.RESOLVED,
        )
        db.session.commit()
        complaint_id = complaint.id
        headers = _auth_for(app, citizen)

    start = Barrier(2)

    def confirm():
        start.wait()
        with app.test_client() as client:
            return client.post(
                f"{API_PREFIX}/complaints/{complaint_id}/confirm",
                headers=headers,
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = sorted(executor.map(lambda _: confirm(), range(2)))

    assert statuses == [200, 409]
    with app.app_context():
        assert (
            db.session.execute(
                select(func.count(PointsLedger.id)).where(
                    PointsLedger.complaint_id == complaint_id,
                    PointsLedger.reason == PointsReason.COMPLAINT_CLOSED,
                )
            ).scalar_one()
            == 1
        )
        assert (
            db.session.execute(
                select(func.count(StatusHistory.id)).where(
                    StatusHistory.complaint_id == complaint_id,
                    StatusHistory.to_status == ComplaintStatus.CLOSED,
                )
            ).scalar_one()
            == 1
        )


def test_concurrent_cluster_confirms_reward_cluster_and_citizen_once(tmp_path):
    from app.extensions import db

    app = _file_backed_app(tmp_path)
    with app.app_context():
        zone, category, citizen, other_citizen = _base_entities(db.session)
        cluster = ComplaintCluster(
            category_id=category.id,
            zone_id=zone.id,
            centroid_lat=12.0,
            centroid_lng=77.0,
            report_count=3,
            unique_reporter_count=2,
            reward_granted=False,
            updated_at=_utcnow(),
        )
        db.session.add(cluster)
        db.session.flush()
        complaints = [
            _create_complaint(
                db.session,
                citizen_id=reporter.id,
                zone_id=zone.id,
                category_id=category.id,
                cluster_id=cluster.id,
                complaint_code=f"KTV-2026-00012{index}",
                status=ComplaintStatus.RESOLVED,
            )
            for index, reporter in enumerate(
                [citizen, other_citizen, other_citizen],
                start=1,
            )
        ]
        db.session.commit()
        complaint_ids = [complaint.id for complaint in complaints]
        cluster_id = cluster.id
        headers = [_auth_for(app, citizen), _auth_for(app, other_citizen)]

    start = Barrier(2)

    def confirm(index):
        start.wait()
        with app.test_client() as client:
            return client.post(
                f"{API_PREFIX}/complaints/{complaint_ids[index]}/confirm",
                headers=headers[index],
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(confirm, range(2)))
    assert statuses == [200, 200]

    with app.test_client() as client:
        duplicate_reporter_status = client.post(
            f"{API_PREFIX}/complaints/{complaint_ids[2]}/confirm",
            headers=headers[1],
        ).status_code
    assert duplicate_reporter_status == 200

    with app.app_context():
        rewards = list(
            db.session.execute(
                select(PointsLedger).where(
                    PointsLedger.complaint_id.in_(complaint_ids),
                    PointsLedger.reason.in_(
                        [
                            PointsReason.COMPLAINT_CLOSED,
                            PointsReason.CLUSTER_MEMBER_CLOSED,
                        ]
                    ),
                )
            ).scalars()
        )
        assert sorted(reward.points_change for reward in rewards) == [10, 50]
        assert len({reward.citizen_id for reward in rewards}) == 2
        assert db.session.get(ComplaintCluster, cluster_id).reward_granted is True


def test_concurrent_cluster_confirms_by_one_citizen_pay_that_citizen_once(tmp_path):
    """The duplicate-reporter rule has to hold when both confirms land together.

    The sequential version of this is covered above. This is the version that
    would double-pay if the per-citizen check and the reward claim were allowed
    to interleave.
    """
    from app.extensions import db

    app = _file_backed_app(tmp_path)
    with app.app_context():
        zone, category, citizen, _ = _base_entities(db.session)
        cluster = ComplaintCluster(
            category_id=category.id,
            zone_id=zone.id,
            centroid_lat=12.0,
            centroid_lng=77.0,
            report_count=2,
            unique_reporter_count=1,
            reward_granted=False,
            updated_at=_utcnow(),
        )
        db.session.add(cluster)
        db.session.flush()
        complaint_ids = [
            _create_complaint(
                db.session,
                citizen_id=citizen.id,
                zone_id=zone.id,
                category_id=category.id,
                cluster_id=cluster.id,
                complaint_code=f"KTV-2026-00014{index}",
                status=ComplaintStatus.RESOLVED,
            ).id
            for index in (1, 2)
        ]
        db.session.commit()
        citizen_id = citizen.id
        headers = _auth_for(app, citizen)

    start = Barrier(2)

    def confirm(index):
        start.wait()
        with app.test_client() as client:
            return client.post(
                f"{API_PREFIX}/complaints/{complaint_ids[index]}/confirm",
                headers=headers,
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(confirm, range(2)))

    # Both complaints close — only one of them pays.
    assert statuses == [200, 200]
    with app.app_context():
        rewards = list(
            db.session.execute(
                select(PointsLedger).where(
                    PointsLedger.citizen_id == citizen_id,
                    PointsLedger.reason.in_(
                        [
                            PointsReason.COMPLAINT_CLOSED,
                            PointsReason.CLUSTER_MEMBER_CLOSED,
                        ]
                    ),
                )
            ).scalars()
        )
        assert [reward.points_change for reward in rewards] == [50]


def test_duplicate_cluster_confirm_leaves_the_reward_for_the_next_member(
    seeded_app, session, auth_header
):
    """A citizen who is already paid must not consume the cluster's one-time +50.

    Confirming their second complaint credits nothing — and the next member to
    confirm must still get the full COMPLAINT_CLOSED, not the +10 consolation.
    """
    client = seeded_app.test_client()
    zone, category, citizen, other_citizen = _base_entities(session)
    cluster = ComplaintCluster(
        category_id=category.id,
        zone_id=zone.id,
        centroid_lat=12.0,
        centroid_lng=77.0,
        report_count=3,
        unique_reporter_count=2,
        reward_granted=False,
        updated_at=_utcnow(),
    )
    session.add(cluster)
    session.flush()
    complaints = [
        _create_complaint(
            session,
            citizen_id=reporter.id,
            zone_id=zone.id,
            category_id=category.id,
            cluster_id=cluster.id,
            complaint_code=f"KTV-2026-00015{index}",
            status=ComplaintStatus.RESOLVED,
        )
        for index, reporter in enumerate([citizen, citizen, other_citizen], start=1)
    ]
    session.commit()

    # This citizen was paid outside the cluster's reward flag — the situation a
    # later cluster link can produce, where `reward_granted` is still false.
    session.add(
        PointsLedger(
            citizen_id=citizen.id,
            complaint_id=complaints[0].id,
            points_change=50,
            reason=PointsReason.COMPLAINT_CLOSED,
            created_at=_utcnow(),
        )
    )
    session.commit()

    duplicate = client.post(
        f"{API_PREFIX}/complaints/{complaints[1].id}/confirm",
        headers=auth_header(citizen),
    )
    assert duplicate.status_code == 200
    assert session.get(ComplaintCluster, cluster.id).reward_granted is False

    next_member = client.post(
        f"{API_PREFIX}/complaints/{complaints[2].id}/confirm",
        headers=auth_header(other_citizen),
    )
    assert next_member.status_code == 200
    reward = session.execute(
        select(PointsLedger).where(
            PointsLedger.citizen_id == other_citizen.id,
            PointsLedger.complaint_id == complaints[2].id,
            PointsLedger.reason.in_(
                [PointsReason.COMPLAINT_CLOSED, PointsReason.CLUSTER_MEMBER_CLOSED]
            ),
        )
    ).scalar_one()
    assert reward.reason is PointsReason.COMPLAINT_CLOSED
    assert reward.points_change == 50
    # The duplicate confirm credited nothing.
    assert (
        session.execute(
            select(func.count(PointsLedger.id)).where(
                PointsLedger.complaint_id == complaints[1].id
            )
        ).scalar_one()
        == 0
    )


def test_confirm_resolution_rejects_wrong_status(seeded_app, session, auth_header):
    client = seeded_app.test_client()
    zone, category, citizen, _ = _base_entities(session)
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000106",
        status=ComplaintStatus.IN_PROGRESS,
    )
    session.commit()

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/confirm",
        headers=auth_header(citizen),
    )

    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "INVALID_TRANSITION"


def test_dispute_resolution_success(seeded_app, session, auth_header):
    client = seeded_app.test_client()
    zone, category, citizen, _ = _base_entities(session)
    cluster = ComplaintCluster(
        category_id=category.id,
        zone_id=zone.id,
        centroid_lat=12.0,
        centroid_lng=77.0,
        report_count=1,
        unique_reporter_count=1,
        reward_granted=False,
        updated_at=_utcnow(),
    )
    session.add(cluster)
    session.flush()
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        cluster_id=cluster.id,
        complaint_code="KTV-2026-000107",
        status=ComplaintStatus.RESOLVED,
        sla_started_at=_utcnow() - timedelta(hours=10),
        sla_target_hours=24,
    )
    session.commit()

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/dispute",
        headers=auth_header(citizen),
        data={"reason": "Still broken", "photo": _png_file("dispute.png")},
        content_type="multipart/form-data",
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "REOPENED"
    assert body["clusterId"] == str(cluster.id)
    assert len(body["evidence"]) == 2
    history = body["statusHistory"][-1]
    assert history["toStatus"] == "REOPENED"
    assert history["reason"] == "Still broken"
    evidence = (
        session.execute(
            select(ComplaintEvidence)
            .where(ComplaintEvidence.complaint_id == complaint.id)
            .order_by(ComplaintEvidence.sequence)
        )
        .scalars()
        .all()
    )
    assert [row.sequence for row in evidence] == [1, 2]
    assert evidence[-1].verdict is None
    assert (
        session.execute(
            select(func.count(PointsLedger.id)).where(PointsLedger.complaint_id == complaint.id)
        ).scalar_one()
        == 0
    )

    repeat = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/dispute",
        headers=auth_header(citizen),
        data={"reason": "Still broken", "photo": _png_file("repeat.png")},
        content_type="multipart/form-data",
    )
    assert repeat.status_code == 409
    assert (
        session.execute(
            select(func.count(ComplaintEvidence.id)).where(
                ComplaintEvidence.complaint_id == complaint.id
            )
        ).scalar_one()
        == 2
    )


def test_dispute_resolution_requires_a_photo(seeded_app, session, auth_header):
    client = seeded_app.test_client()
    zone, category, citizen, _ = _base_entities(session)
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000108",
        status=ComplaintStatus.RESOLVED,
    )
    session.commit()

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/dispute",
        headers=auth_header(citizen),
        data={"reason": "Still broken"},
        content_type="multipart/form-data",
    )

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "VALIDATION_ERROR"

    missing_reason = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/dispute",
        headers=auth_header(citizen),
        data={"photo": _png_file()},
        content_type="multipart/form-data",
    )
    assert missing_reason.status_code == 400
    assert missing_reason.get_json()["error"]["code"] == "VALIDATION_ERROR"


def test_dispute_resolution_rejects_blank_reason(seeded_app, session, auth_header):
    client = seeded_app.test_client()
    zone, category, citizen, _ = _base_entities(session)
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000108A",
        status=ComplaintStatus.RESOLVED,
    )
    session.commit()

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/dispute",
        headers=auth_header(citizen),
        data={"reason": "   ", "photo": _png_file()},
        content_type="multipart/form-data",
    )

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "VALIDATION_ERROR"
    assert session.get(Complaint, complaint.id).status is ComplaintStatus.RESOLVED


@pytest.mark.parametrize("photo_kind", ["invalid", "oversized"])
def test_dispute_resolution_rejects_invalid_photo(
    seeded_app, session, auth_header, photo_kind
):
    client = seeded_app.test_client()
    zone, category, citizen, _ = _base_entities(session)
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code=f"KTV-2026-000108-{photo_kind}",
        status=ComplaintStatus.RESOLVED,
    )
    session.commit()
    photo = (
        (BytesIO(b"not-an-image"), "photo.txt")
        if photo_kind == "invalid"
        else _oversized_png(seeded_app.config["MAX_UPLOAD_BYTES"])
    )

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/dispute",
        headers=auth_header(citizen),
        data={"reason": "Still broken", "photo": photo},
        content_type="multipart/form-data",
    )

    assert response.status_code == 400
    assert response.get_json()["error"]["code"] == "VALIDATION_ERROR"
    assert session.get(Complaint, complaint.id).status is ComplaintStatus.RESOLVED
    assert (
        session.execute(
            select(func.count(ComplaintEvidence.id)).where(
                ComplaintEvidence.complaint_id == complaint.id
            )
        ).scalar_one()
        == 1
    )


def test_concurrent_disputes_return_one_success_and_one_conflict(tmp_path, monkeypatch):
    """Force both requests to reach the guarded transition together."""
    from app.extensions import db
    from app.services.complaints import lifecycle as lifecycle_service

    app = _file_backed_app(tmp_path)
    with app.app_context():
        zone, category, citizen, _ = _base_entities(db.session)
        complaint = _create_complaint(
            db.session,
            citizen_id=citizen.id,
            zone_id=zone.id,
            category_id=category.id,
            complaint_code="KTV-2026-000108B",
            status=ComplaintStatus.RESOLVED,
        )
        db.session.commit()
        complaint_id = complaint.id
        headers = _auth_for(app, citizen)

    transition_barrier = Barrier(2)
    original_apply_transition = lifecycle_service.apply_transition

    def synchronized_apply_transition(**kwargs):
        transition_barrier.wait()
        return original_apply_transition(**kwargs)

    monkeypatch.setattr(
        lifecycle_service,
        "apply_transition",
        synchronized_apply_transition,
    )

    def dispute(index):
        with app.test_client() as client:
            response = client.post(
                f"{API_PREFIX}/complaints/{complaint_id}/dispute",
                headers=headers,
                data={
                    "reason": "Still broken",
                    "photo": _png_file(f"dispute-{index}.png"),
                },
                content_type="multipart/form-data",
            )
            return response.status_code, response.get_json()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(dispute, range(2)))

    assert sorted(status for status, _ in results) == [200, 409]
    losing_body = next(body for status, body in results if status == 409)
    assert losing_body["error"]["code"] == "INVALID_TRANSITION"
    with app.app_context():
        assert (
            db.session.execute(
                select(func.count(ComplaintEvidence.id)).where(
                    ComplaintEvidence.complaint_id == complaint_id
                )
            ).scalar_one()
            == 2
        )
        assert (
            db.session.execute(
                select(func.count(StatusHistory.id)).where(
                    StatusHistory.complaint_id == complaint_id,
                    StatusHistory.to_status == ComplaintStatus.REOPENED,
                )
            ).scalar_one()
            == 1
        )


def test_owner_only_actions_reject_another_citizen(seeded_app, session, auth_header):
    client = seeded_app.test_client()
    zone, category, citizen, other_citizen = _base_entities(session)
    evidence_complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000130",
        status=ComplaintStatus.NEEDS_MORE_EVIDENCE,
    )
    confirm_complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000131",
        status=ComplaintStatus.RESOLVED,
    )
    dispute_complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000132",
        status=ComplaintStatus.RESOLVED,
    )
    session.commit()
    headers = auth_header(other_citizen)

    responses = [
        client.post(
            f"{API_PREFIX}/complaints/{evidence_complaint.id}/evidence",
            headers=headers,
            data={"photo": _png_file()},
            content_type="multipart/form-data",
        ),
        client.post(
            f"{API_PREFIX}/complaints/{confirm_complaint.id}/confirm",
            headers=headers,
        ),
        client.post(
            f"{API_PREFIX}/complaints/{dispute_complaint.id}/dispute",
            headers=headers,
            data={"reason": "Still broken", "photo": _png_file()},
            content_type="multipart/form-data",
        ),
    ]

    assert [response.status_code for response in responses] == [403, 403, 403]
    assert (
        session.get(Complaint, evidence_complaint.id).status is ComplaintStatus.NEEDS_MORE_EVIDENCE
    )
    assert session.get(Complaint, confirm_complaint.id).status is ComplaintStatus.RESOLVED
    assert session.get(Complaint, dispute_complaint.id).status is ComplaintStatus.RESOLVED


@pytest.mark.parametrize("action", ["evidence", "upvote", "confirm", "dispute"])
def test_complaint_actions_return_not_found_for_unknown_id(
    seeded_app, session, auth_header, action
):
    client = seeded_app.test_client()
    zone, _, citizen, _ = _base_entities(session)
    assert zone.id == citizen.zone_id
    request_kwargs = {"headers": auth_header(citizen)}
    if action == "evidence":
        request_kwargs.update(
            data={"photo": _png_file()},
            content_type="multipart/form-data",
        )
    elif action == "dispute":
        request_kwargs.update(
            data={"reason": "Still broken", "photo": _png_file()},
            content_type="multipart/form-data",
        )

    response = client.post(
        f"{API_PREFIX}/complaints/999999/{action}",
        **request_kwargs,
    )

    assert response.status_code == 404
    assert response.get_json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.parametrize("action", ["evidence", "upvote", "confirm", "dispute"])
def test_complaint_actions_reject_non_citizen_role(
    seeded_app, session, auth_header, action
):
    client = seeded_app.test_client()
    zone, category, citizen, _ = _base_entities(session)
    officer = _create_user(
        session,
        email=f"officer-{action}@example.com",
        role=UserRole.OFFICER,
        zone_id=zone.id,
    )
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code=f"KTV-2026-ROLE-{action}",
        status=(
            ComplaintStatus.NEEDS_MORE_EVIDENCE
            if action == "evidence"
            else ComplaintStatus.RESOLVED
        ),
    )
    session.commit()
    request_kwargs = {"headers": auth_header(officer)}
    if action == "evidence":
        request_kwargs.update(
            data={"photo": _png_file()},
            content_type="multipart/form-data",
        )
    elif action == "dispute":
        request_kwargs.update(
            data={"reason": "Still broken", "photo": _png_file()},
            content_type="multipart/form-data",
        )

    response = client.post(
        f"{API_PREFIX}/complaints/{complaint.id}/{action}",
        **request_kwargs,
    )

    assert response.status_code == 403
    assert response.get_json()["error"]["code"] == "FORBIDDEN"
