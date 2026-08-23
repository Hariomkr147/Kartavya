"""Tests for public feed and leaderboard endpoints."""

from __future__ import annotations

from datetime import UTC, datetime

from app.api.citizen.serializers import serialize_feed_item
from app.core.context import SerializationContext
from app.domain.enums import ComplaintStatus, PointsReason, UserRole
from app.models.accounts import ComplaintCategory, User, Zone
from app.models.complaints import Complaint
from app.models.gamification import PointsLedger

API_PREFIX = "/api/v1"


def create_user(
    session, role=UserRole.CITIZEN, email="user@example.com", name="Test User", zone_id=None
):
    u = User(
        full_name=name,
        display_name=name,
        email=email,
        password_hash="hash",
        role=role,
        zone_id=zone_id,
        is_active=True,
    )
    session.add(u)
    session.commit()
    return u


def test_get_public_feed_success_and_scoping(seeded_app, client, session, auth_header):
    citizen1 = create_user(session, role=UserRole.CITIZEN, email="feed_cit1@example.com")
    citizen2 = create_user(session, role=UserRole.CITIZEN, email="feed_cit2@example.com")
    category = session.query(ComplaintCategory).first()
    zone1 = session.query(Zone).first()

    zone2 = Zone(
        zone_code="ZFEED2",
        zone_name="Zone Feed 2",
        center_lat=12.98,
        center_lng=77.60,
        is_active=True,
    )
    session.add(zone2)
    session.commit()

    citizen1.zone_id = zone1.id
    citizen2.zone_id = zone2.id
    session.commit()

    # Create complaint directly via ORM
    complaint = Complaint(
        complaint_code="KTV-2026-0001",
        citizen_id=citizen1.id,
        zone_id=zone1.id,
        category_id=category.id,
        description="Public feed complaint",
        latitude=12.9716,
        longitude=77.5946,
        status=ComplaintStatus.SUBMITTED,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    session.add(complaint)
    session.commit()

    # 1. Citizen 1 gets feed for their zone -> 200 OK
    headers1 = auth_header(citizen1)
    res1 = client.get(f"{API_PREFIX}/feed", headers=headers1)
    assert res1.status_code == 200
    feed1 = res1.get_json()
    assert len(feed1["data"]) == 1
    assert feed1["data"][0]["id"] == str(complaint.id)
    assert "reporter" not in feed1["data"][0]

    # 2. Citizen 2 requests zone 1 (not their zone) -> 403 Forbidden
    headers2 = auth_header(citizen2)
    res2 = client.get(f"{API_PREFIX}/feed?zoneId={zone1.id}", headers=headers2)
    assert res2.status_code == 403


def test_leaderboard_sequential_ranks_and_filtering(seeded_app, client, session, auth_header):
    c1 = create_user(session, role=UserRole.CITIZEN, email="lead1@example.com", name="Alice")
    c2 = create_user(session, role=UserRole.CITIZEN, email="lead2@example.com", name="Bob")

    # Award points to c2 using PointsReason enum (P6-4)
    ledger_entry = PointsLedger(
        citizen_id=c2.id,
        points_change=50,
        reason=PointsReason.COMPLAINT_CLOSED,
        created_at=datetime.now(UTC),
    )
    session.add(ledger_entry)
    session.commit()

    headers = auth_header(c1)
    res = client.get(f"{API_PREFIX}/leaderboard?scope=city&period=monthly", headers=headers)
    assert res.status_code == 200
    data = res.get_json()
    assert "data" in data
    assert "currentUser" in data
    assert data["scope"] == "city"
    assert data["period"] == "monthly"
    assert data["data"][0]["displayName"] == "Bob"
    assert data["data"][0]["points"] == 50


def test_leaderboard_is_readable_by_an_admin_but_not_an_officer(
    seeded_app, client, session, auth_header
):
    """Contract 3.1.0 widened this endpoint to admins for cross-zone oversight.

    Reading the board is not the same as being on it: the admin is not a
    CITIZEN, so no row matches them and `currentUser` must come back `null`
    rather than inventing a rank for an account that earns no points.
    """
    citizen = create_user(session, role=UserRole.CITIZEN, email="board_cit@example.com")
    admin = create_user(session, role=UserRole.ADMIN, email="board_admin@example.com")
    officer = create_user(session, role=UserRole.OFFICER, email="board_officer@example.com")

    session.add(
        PointsLedger(
            citizen_id=citizen.id,
            points_change=30,
            reason=PointsReason.COMPLAINT_CLOSED,
            created_at=datetime.now(UTC),
        )
    )
    session.commit()

    res = client.get(
        f"{API_PREFIX}/leaderboard?scope=city&period=monthly", headers=auth_header(admin)
    )
    assert res.status_code == 200
    data = res.get_json()
    assert data["currentUser"] is None
    # The ranking itself is untouched by who is reading it.
    assert [e["citizenId"] for e in data["data"]] == [str(citizen.id)]
    # And the admin is never ranked, only ever a reader.
    assert all(e["citizenId"] != str(admin.id) for e in data["data"])

    res = client.get(
        f"{API_PREFIX}/leaderboard?scope=city&period=monthly", headers=auth_header(officer)
    )
    assert res.status_code == 403


def test_serialize_feed_item_privacy_and_structure(seeded_app, session):
    category = session.query(ComplaintCategory).first()
    zone = session.query(Zone).first()
    citizen = create_user(session, role=UserRole.CITIZEN, email="privacy_feed@example.com")

    complaint = Complaint(
        complaint_code="KTV-2026-0002",
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        description="Feed item privacy test",
        latitude=12.9716,
        longitude=77.5946,
        status=ComplaintStatus.SUBMITTED,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    session.add(complaint)
    session.commit()

    ctx = SerializationContext(
        now=datetime.now(UTC),
        categories={category.id: category},
        zones={zone.id: zone},
    )

    item = serialize_feed_item(complaint, ctx, citizen_upvoted_ids=set())
    assert item["id"] == str(complaint.id)
    assert item["status"] == "SUBMITTED"
    assert item["latitude"] == 12.9716
    assert item["longitude"] == 77.5946
    assert "reporter" not in item
