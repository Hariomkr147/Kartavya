"""Service-level regressions discovered while reviewing the admin implementation."""

from __future__ import annotations

from app.domain.enums import ComplaintStatus, UserRole
from app.models import Complaint, ComplaintCategory, User, Zone
from app.services.accounts.auth import hash_password
from app.services.analytics.officer import public_officer_stats


def test_public_officer_stats_matches_contract_and_contains_no_identity(seeded_app, session):
    zone = Zone(
        zone_code="PUBLIC-STATS",
        zone_name="Public Stats",
        center_lat=12.9,
        center_lng=77.6,
        is_catch_all=False,
        is_active=True,
    )
    officer = User(
        full_name="Private Officer Name",
        email="private-officer@example.com",
        password_hash=hash_password("password123"),
        role=UserRole.OFFICER,
        zone_id=None,
        is_active=True,
    )
    citizen = User(
        full_name="Private Citizen Name",
        email="private-citizen@example.com",
        password_hash=hash_password("password123"),
        role=UserRole.CITIZEN,
        zone_id=None,
        is_active=True,
    )
    session.add_all([zone, officer, citizen])
    session.flush()
    officer.zone_id = zone.id
    citizen.zone_id = zone.id
    category = session.query(ComplaintCategory).order_by(ComplaintCategory.id).first()
    complaint = Complaint(
        complaint_code="PUBLIC-STATS-1",
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        assigned_officer_id=officer.id,
        latitude=12.9,
        longitude=77.6,
        status=ComplaintStatus.RESOLVED,
        severity_score=0,
    )
    session.add(complaint)
    session.commit()

    payload = public_officer_stats(officer_id=officer.id)

    assert payload == {"officerId": str(officer.id), "totalResolved": 1}
    assert "resolvedCount" not in payload
    assert "name" not in payload
    assert "email" not in payload
