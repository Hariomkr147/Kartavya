"""Tests for admin CSV export."""

from __future__ import annotations

from datetime import datetime, timedelta

from app.domain.enums import ComplaintStatus, UserRole
from app.models import Complaint, ComplaintCategory, User, Zone

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


def test_export_complaints_csv(seeded_app, client, session, auth_header):
    admin = create_user(session, role=UserRole.ADMIN, email="admin_exp@example.com")
    headers = auth_header(admin)

    res = client.get(f"{API_PREFIX}/admin/export/complaints", headers=headers)
    assert res.status_code == 200
    assert res.content_type == "text/csv; charset=utf-8"
    csv_text = res.get_data(as_text=True)
    assert "ID,Complaint Code,Category Code" in csv_text


def test_export_complaints_csv_non_admin_forbidden(seeded_app, client, session, auth_header):
    citizen = create_user(session, role=UserRole.CITIZEN, email="non_admin_exp@example.com")
    headers = auth_header(citizen)

    res = client.get(f"{API_PREFIX}/admin/export/complaints", headers=headers)
    assert res.status_code == 403


def test_export_complaints_csv_invalid_query_400(seeded_app, client, session, auth_header):
    admin = create_user(session, role=UserRole.ADMIN, email="admin_exp_bad@example.com")
    headers = auth_header(admin)

    # Unknown parameter forbidden by Pydantic extra="forbid"
    res = client.get(f"{API_PREFIX}/admin/export/complaints?unknownParam=123", headers=headers)
    assert res.status_code == 400


def test_export_filters_exact_sla_escapes_csv_and_excludes_personal_identity(
    seeded_app, client, session, auth_header, monkeypatch
):
    fixed_now = datetime(2026, 7, 10, 12)
    monkeypatch.setattr("app.api.admin.routes._utcnow", lambda: fixed_now)
    admin = create_user(session, role=UserRole.ADMIN, email="csv-admin@example.com")
    zone = session.query(Zone).order_by(Zone.id).first()
    category = session.query(ComplaintCategory).order_by(ComplaintCategory.id).first()
    citizen = create_user(
        session,
        role=UserRole.CITIZEN,
        email="secret-csv-email@example.com",
        name="Secret CSV Citizen",
        zone_id=zone.id,
    )
    complaint = Complaint(
        complaint_code="CSV,BOUNDARY",
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        description="Secret free-text description",
        latitude=12.9,
        longitude=77.6,
        status=ComplaintStatus.IN_PROGRESS,
        severity_score=0,
        sla_target_hours=100,
        sla_started_at=fixed_now - timedelta(hours=100),
        created_at=datetime(2026, 7, 2, 0),
        updated_at=datetime(2026, 7, 2, 0),
    )
    session.add(complaint)
    session.commit()
    headers = auth_header(admin)

    response = client.get(
        f"{API_PREFIX}/admin/export/complaints?zoneId={zone.id}"
        f"&categoryId={category.id}&status=IN_PROGRESS&slaLabel=OVERDUE"
        "&dateFrom=2026-07-02T00:00:00Z&dateTo=2026-07-02T00:00:00Z",
        headers=headers,
    )
    assert response.status_code == 200
    csv_text = response.get_data(as_text=True)
    assert '"CSV,BOUNDARY"' in csv_text
    assert citizen.email not in csv_text
    assert citizen.full_name not in csv_text
    assert complaint.description not in csv_text

    excluded = client.get(
        f"{API_PREFIX}/admin/export/complaints?status=CLOSED",
        headers=headers,
    ).get_data(as_text=True)
    assert "CSV,BOUNDARY" not in excluded
