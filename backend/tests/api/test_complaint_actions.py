from __future__ import annotations

from datetime import UTC, datetime, timedelta
from io import BytesIO

from sqlalchemy import select

from app.domain.enums import AiScreenStatus, ComplaintStatus, PointsReason, StatusActor, UserRole
from app.models import Complaint, ComplaintEvidence, ComplaintUpvote, PointsLedger, StatusHistory, User
from app.services.accounts.auth import hash_password
from app.settings import API_PREFIX


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _png_file(name: str = "photo.png"):
    return (BytesIO(b"\x89PNG\r\n\x1a\nexample-payload"), name)


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
) -> Complaint:
    now = _utcnow()
    complaint = Complaint(
        complaint_code=complaint_code,
        citizen_id=citizen_id,
        zone_id=zone_id,
        category_id=category_id,
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
        StatusHistory(
            complaint_id=complaint.id,
            from_status=None,
            to_status=status,
            actor_role=StatusActor.CITIZEN,
            changed_by_user_id=citizen_id,
            created_at=now,
        )
    )
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


def _seed_case(session):
    zone = session.execute(select(User.zone.property.entity.class_).where(False)).scalar_one_or_none()


def _base_entities(session):
    from app.models import ComplaintCategory, Zone

    zone = session.execute(select(Zone).where(Zone.is_catch_all.is_(True))).scalar_one()
    category = session.execute(select(ComplaintCategory)).scalars().first()
    assert category is not None
    citizen = _create_user(session, email="citizen@example.com", role=UserRole.CITIZEN, zone_id=zone.id)
    other_citizen = _create_user(
        session,
        email="other@example.com",
        role=UserRole.CITIZEN,
        zone_id=zone.id,
    )
    session.commit()
    return zone, category, citizen, other_citizen


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
    ledger = session.execute(
        select(PointsLedger).where(PointsLedger.complaint_id == complaint.id)
    ).scalars().all()
    assert len(ledger) == 1
    assert ledger[0].reason is PointsReason.UPVOTE_RECEIVED
    assert ledger[0].points_change == 5


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
    ledger = session.execute(
        select(PointsLedger).where(PointsLedger.complaint_id == complaint.id)
    ).scalars().all()
    assert [row.reason for row in ledger] == [PointsReason.COMPLAINT_CLOSED]
    assert ledger[0].points_change == 50


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
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
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
    assert len(body["evidence"]) == 2
    history = body["statusHistory"][-1]
    assert history["toStatus"] == "REOPENED"
    assert history["reason"] == "Still broken"


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
