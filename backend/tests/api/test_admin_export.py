"""Tests for admin CSV export."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.domain.enums import ComplaintStatus, UserRole
from app.models.accounts import ComplaintCategory, User, Zone
from app.models.complaints import Complaint

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


def test_export_complaints_csv_headers_and_row_content(seeded_app, client, session, auth_header):
    admin = create_user(session, role=UserRole.ADMIN, email="admin_exp@example.com")
    citizen = create_user(session, role=UserRole.CITIZEN, email="cit_exp@example.com")
    category = session.query(ComplaintCategory).first()
    zone = session.query(Zone).first()

    complaint = Complaint(
        complaint_code="KTV-2026-9999",
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        description="CSV Export Test Complaint",
        latitude=12.9716,
        longitude=77.5946,
        status=ComplaintStatus.SUBMITTED,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    session.add(complaint)
    session.commit()

    headers = auth_header(admin)
    res = client.get(f"{API_PREFIX}/admin/export/complaints", headers=headers)
    assert res.status_code == 200
    assert res.content_type == "text/csv; charset=utf-8"

    csv_text = res.get_data(as_text=True)
    lines = [line.strip() for line in csv_text.strip().split("\n") if line.strip()]

    header_cols = lines[0].split(",")
    assert header_cols[0] == "ID"
    assert header_cols[1] == "Complaint Code"
    assert "KTV-2026-9999" in csv_text
    assert category.category_code in csv_text


def test_export_complaints_csv_filtering_by_zone_and_category(
    seeded_app, client, session, auth_header
):
    admin = create_user(session, role=UserRole.ADMIN, email="admin_exp_filt@example.com")
    citizen = create_user(session, role=UserRole.CITIZEN, email="cit_exp_filt@example.com")
    category = session.query(ComplaintCategory).first()
    zone = session.query(Zone).first()

    complaint = Complaint(
        complaint_code="KTV-2026-8888",
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        description="Filtered complaint",
        latitude=12.9716,
        longitude=77.5946,
        status=ComplaintStatus.SUBMITTED,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    session.add(complaint)
    session.commit()

    headers = auth_header(admin)

    # Filter matching zone & category -> 200 OK with row
    res = client.get(
        f"{API_PREFIX}/admin/export/complaints?zoneId={zone.id}&categoryId={category.id}",
        headers=headers,
    )
    assert res.status_code == 200
    assert "KTV-2026-8888" in res.get_data(as_text=True)

    # Filter with non-matching zone -> returns header only
    res_empty = client.get(
        f"{API_PREFIX}/admin/export/complaints?zoneId=99999",
        headers=headers,
    )
    assert res_empty.status_code == 200
    data_str = res_empty.get_data(as_text=True)
    empty_lines = [line.strip() for line in data_str.strip().split("\n") if line.strip()]
    assert len(empty_lines) == 1
    assert "KTV-2026-8888" not in data_str


def test_export_complaints_csv_filtering_by_date_range(
    seeded_app, client, session, auth_header
):
    admin = create_user(session, role=UserRole.ADMIN, email="admin_exp_date@example.com")
    citizen = create_user(session, role=UserRole.CITIZEN, email="cit_exp_date@example.com")
    category = session.query(ComplaintCategory).first()
    zone = session.query(Zone).first()

    now = datetime.now(UTC)
    complaint = Complaint(
        complaint_code="KTV-2026-7777",
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category.id,
        description="Date filtered complaint",
        latitude=12.9716,
        longitude=77.5946,
        status=ComplaintStatus.SUBMITTED,
        created_at=now,
        updated_at=now,
    )
    session.add(complaint)
    session.commit()

    headers = auth_header(admin)
    date_from_str = (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    date_to_str = (now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")

    res = client.get(
        f"{API_PREFIX}/admin/export/complaints?dateFrom={date_from_str}&dateTo={date_to_str}",
        headers=headers,
    )
    assert res.status_code == 200
    assert "KTV-2026-7777" in res.get_data(as_text=True)


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
