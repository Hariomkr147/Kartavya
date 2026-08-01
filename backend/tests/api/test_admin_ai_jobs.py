"""Tests for AI zone reports and auto-close sweeper."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

from app.domain.enums import ComplaintStatus, UserRole
from app.jobs.auto_close import sweep_auto_close
from app.models.accounts import ComplaintCategory, User, Zone
from app.models.complaints import Complaint
from app.models.system import AppSettings

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


def test_generate_and_get_ai_zone_report(seeded_app, client, session, auth_header):
    admin = create_user(session, role=UserRole.ADMIN, email="admin_ai@example.com")
    zone = session.query(Zone).first()
    headers = auth_header(admin)

    # Trigger report generation -> 202 Accepted
    res_post = client.post(f"{API_PREFIX}/admin/zones/{zone.id}/ai-report", headers=headers)
    assert res_post.status_code == 202
    post_data = res_post.get_json()
    assert post_data["zoneId"] == str(zone.id)
    assert post_data["status"] == "PENDING"

    # Give background thread time to process
    time.sleep(0.5)

    # Get report -> 200 OK
    res_get = client.get(f"{API_PREFIX}/admin/zones/{zone.id}/ai-report", headers=headers)
    assert res_get.status_code == 200
    get_data = res_get.get_json()
    assert get_data["zoneId"] == str(zone.id)


def test_ai_zone_report_non_admin_forbidden(seeded_app, client, session, auth_header):
    citizen = create_user(session, role=UserRole.CITIZEN, email="cit_ai@example.com")
    zone = session.query(Zone).first()
    headers = auth_header(citizen)

    res = client.post(f"{API_PREFIX}/admin/zones/{zone.id}/ai-report", headers=headers)
    assert res.status_code == 403


def test_ai_zone_report_invalid_zone_404(seeded_app, client, session, auth_header):
    admin = create_user(session, role=UserRole.ADMIN, email="admin_ai_404@example.com")
    headers = auth_header(admin)

    res = client.post(f"{API_PREFIX}/admin/zones/abc/ai-report", headers=headers)
    assert res.status_code == 404


def test_auto_close_sweeper(seeded_app, session):
    citizen = create_user(session, role=UserRole.CITIZEN, email="sweeper_cit@example.com")
    category = session.query(ComplaintCategory).first()
    zone = session.query(Zone).first()

    complaint = Complaint(
        complaint_code="KTV-2026-0001",
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        description="Sweeper test complaint",
        latitude=12.9716,
        longitude=77.5946,
        status=ComplaintStatus.RESOLVED,
        resolved_at=datetime.now(UTC) - timedelta(hours=200),
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    session.add(complaint)
    session.commit()

    # Set app settings timeout to 168 hours
    settings = session.query(AppSettings).filter_by(id=1).first()
    if not settings:
        settings = AppSettings(id=1, auto_close_timeout_hours=168)
        session.add(settings)
    else:
        settings.auto_close_timeout_hours = 168
    session.commit()

    # Run sweeper
    count = sweep_auto_close(seeded_app)
    assert count == 1

    session.refresh(complaint)
    assert complaint.status == ComplaintStatus.CLOSED
