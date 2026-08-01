"""Tests for admin CSV export."""

from __future__ import annotations

from app.domain.enums import UserRole
from app.models.accounts import User


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

    res = client.get("/api/v1/admin/export/complaints", headers=headers)
    assert res.status_code == 200
    assert res.content_type == "text/csv; charset=utf-8"
    csv_text = res.get_data(as_text=True)
    assert "ID,Complaint Code,Category Code" in csv_text
