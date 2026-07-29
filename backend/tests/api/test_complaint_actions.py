from __future__ import annotations

from datetime import UTC, datetime, timedelta
from io import BytesIO

from flask import g
from sqlalchemy import func, select

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


def test_upvote_enforces_every_contract_restriction(seeded_app, session, auth_header):
    client = seeded_app.test_client()
    zone, category, citizen, other_citizen = _base_entities(session)
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
    active = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000109",
        status=ComplaintStatus.UNDER_REVIEW,
    )
    closed = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000110",
        status=ComplaintStatus.CLOSED,
    )
    session.commit()
    citizen_auth = auth_header(citizen)
    outsider_auth = auth_header(outsider)
    other_auth = auth_header(other_citizen)

    self_upvote = client.post(
        f"{API_PREFIX}/complaints/{active.id}/upvote",
        headers=citizen_auth,
    )
    g.pop("current_user", None)
    cross_zone = client.post(
        f"{API_PREFIX}/complaints/{active.id}/upvote",
        headers=outsider_auth,
    )
    g.pop("current_user", None)
    closed_upvote = client.post(
        f"{API_PREFIX}/complaints/{closed.id}/upvote",
        headers=other_auth,
    )

    assert self_upvote.status_code == 403
    assert cross_zone.status_code == 403
    assert closed_upvote.status_code == 409
    assert closed_upvote.get_json()["error"]["code"] == "COMPLAINT_CLOSED"


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


def test_interleaved_confirm_allows_only_one_winner(
    seeded_app, session, auth_header, monkeypatch
):
    import app.api.citizen.routes as citizen_routes

    zone, category, citizen, _ = _base_entities(session)
    complaint = _create_complaint(
        session,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        complaint_code="KTV-2026-000111",
        status=ComplaintStatus.RESOLVED,
    )
    session.commit()
    complaint_id = complaint.id
    headers = auth_header(citizen)
    validate_confirm = citizen_routes.validate_confirm
    competitor_response = None
    interleaved = False

    def interleave_competing_request(status):
        nonlocal competitor_response, interleaved
        result = validate_confirm(status)
        if not interleaved:
            interleaved = True
            with seeded_app.test_client() as competitor:
                competitor_response = competitor.post(
                    f"{API_PREFIX}/complaints/{complaint_id}/confirm",
                    headers=headers,
                )
        return result

    monkeypatch.setattr(
        citizen_routes,
        "validate_confirm",
        interleave_competing_request,
    )
    with seeded_app.test_client() as client:
        stale_response = client.post(
            f"{API_PREFIX}/complaints/{complaint_id}/confirm",
            headers=headers,
        )

    assert competitor_response is not None
    assert competitor_response.status_code == 200
    assert stale_response.status_code == 409
    session.expire_all()
    assert session.execute(
        select(func.count(PointsLedger.id)).where(
            PointsLedger.complaint_id == complaint_id,
            PointsLedger.reason == PointsReason.COMPLAINT_CLOSED,
        )
    ).scalar_one() == 1
    assert session.execute(
        select(func.count(StatusHistory.id)).where(
            StatusHistory.complaint_id == complaint_id,
            StatusHistory.to_status == ComplaintStatus.CLOSED,
        )
    ).scalar_one() == 1


def test_cluster_confirmation_rewards_are_not_repeated(
    seeded_app, session, auth_header
):
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
            complaint_code=f"KTV-2026-00011{index}",
            status=ComplaintStatus.RESOLVED,
        )
        for index, reporter in enumerate(
            [citizen, other_citizen, other_citizen],
            start=2,
        )
    ]
    session.commit()
    citizen_auth = auth_header(citizen)
    other_auth = auth_header(other_citizen)

    responses = []
    for complaint, headers in [
        (complaints[0], citizen_auth),
        (complaints[1], other_auth),
        (complaints[2], other_auth),
    ]:
        g.pop("current_user", None)
        responses.append(
            client.post(
                f"{API_PREFIX}/complaints/{complaint.id}/confirm",
                headers=headers,
            )
        )

    assert [response.status_code for response in responses] == [200, 200, 200]
    rewards = (
        session.execute(
            select(PointsLedger)
            .where(
                PointsLedger.complaint_id.in_([complaint.id for complaint in complaints]),
                PointsLedger.reason.in_(
                    [PointsReason.COMPLAINT_CLOSED, PointsReason.CLUSTER_MEMBER_CLOSED]
                ),
            )
            .order_by(PointsLedger.id)
        )
        .scalars()
        .all()
    )
    assert [(reward.citizen_id, reward.points_change) for reward in rewards] == [
        (citizen.id, 50),
        (other_citizen.id, 10),
    ]
    assert session.get(ComplaintCluster, cluster.id).reward_granted is True


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
