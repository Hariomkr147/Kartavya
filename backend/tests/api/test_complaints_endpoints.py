"""Tests for citizen complaint endpoints: creation, listing, detail."""

from __future__ import annotations

import io

from app.domain.enums import ComplaintStatus, UserRole
from app.models.accounts import ComplaintCategory, User, Zone

API_PREFIX = "/api/v1"


def create_user(
    session,
    role=UserRole.CITIZEN,
    email="user@example.com",
    name="Test User",
    zone_id=None,
    display_name=None,
):
    u = User(
        full_name=name,
        display_name=display_name or name,
        email=email,
        password_hash="hash",
        role=role,
        zone_id=zone_id,
        is_active=True,
    )
    session.add(u)
    session.commit()
    return u


def test_create_complaint_success(seeded_app, client, session, auth_header):
    zone = session.query(Zone).first()
    category = session.query(ComplaintCategory).first()
    citizen = create_user(session, role=UserRole.CITIZEN, email="cit1@example.com", zone_id=zone.id)

    fake_jpeg = io.BytesIO(
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00\x48\x00\x48\x00\x00\xff\xfeTestImageBytes"
    )
    data = {
        "categoryId": str(category.id),
        "zoneId": str(zone.id),
        "latitude": "12.9716",
        "longitude": "77.5946",
        "description": "Deep pothole near central park",
        "photos": (fake_jpeg, "pothole.jpg", "image/jpeg"),
    }

    res = client.post(
        f"{API_PREFIX}/complaints",
        data=data,
        headers=auth_header(citizen),
        content_type="multipart/form-data",
    )
    assert res.status_code == 201
    json_data = res.get_json()

    assert "id" in json_data
    assert json_data["description"] == "Deep pothole near central park"
    assert json_data["status"] == ComplaintStatus.SUBMITTED.value
    assert json_data["zoneId"] == str(zone.id)
    assert json_data["category"]["id"] == str(category.id)
    assert len(json_data["evidence"]) == 1
    assert "reporter" not in json_data


def test_create_complaint_bad_category(seeded_app, client, session, auth_header):
    zone = session.query(Zone).first()
    citizen = create_user(
        session, role=UserRole.CITIZEN, email="bad_cat@example.com", zone_id=zone.id
    )

    fake_jpeg = io.BytesIO(
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00\x48\x00\x48\x00\x00\xff\xfeTestImageBytes"
    )
    data = {
        "categoryId": "99999",
        "zoneId": str(zone.id),
        "latitude": "12.9716",
        "longitude": "77.5946",
        "photos": (fake_jpeg, "test.jpg", "image/jpeg"),
    }

    res = client.post(
        f"{API_PREFIX}/complaints",
        data=data,
        headers=auth_header(citizen),
        content_type="multipart/form-data",
    )
    assert res.status_code == 400


def test_create_complaint_inactive_zone_rejected(seeded_app, client, session, auth_header):
    category = session.query(ComplaintCategory).first()
    inactive_zone = Zone(
        zone_code="ZINACTIVE",
        zone_name="Inactive Zone",
        center_lat=12.0,
        center_lng=77.0,
        is_active=False,
    )
    session.add(inactive_zone)
    session.commit()

    citizen = create_user(session, role=UserRole.CITIZEN, email="cit_inact@example.com")
    fake_jpeg = io.BytesIO(
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00\x48\x00\x48\x00\x00\xff\xfeTestImageBytes"
    )
    data = {
        "categoryId": str(category.id),
        "zoneId": str(inactive_zone.id),
        "latitude": "12.9716",
        "longitude": "77.5946",
        "photos": (fake_jpeg, "test.jpg", "image/jpeg"),
    }

    res = client.post(
        f"{API_PREFIX}/complaints",
        data=data,
        headers=auth_header(citizen),
        content_type="multipart/form-data",
    )
    assert res.status_code == 400


def test_create_complaint_invalid_coordinates(seeded_app, client, session, auth_header):
    zone = session.query(Zone).first()
    category = session.query(ComplaintCategory).first()
    citizen = create_user(session, role=UserRole.CITIZEN, email="cit_bad_coords@example.com")

    fake_jpeg = io.BytesIO(
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00\x48\x00\x48\x00\x00\xff\xfeTestImageBytes"
    )
    data = {
        "categoryId": str(category.id),
        "zoneId": str(zone.id),
        "latitude": "999.0",
        "longitude": "77.5946",
        "photos": (fake_jpeg, "test.jpg", "image/jpeg"),
    }

    res = client.post(
        f"{API_PREFIX}/complaints",
        data=data,
        headers=auth_header(citizen),
        content_type="multipart/form-data",
    )
    assert res.status_code == 400


def test_create_complaint_invalid_photo_magic_bytes(seeded_app, client, session, auth_header):
    zone = session.query(Zone).first()
    category = session.query(ComplaintCategory).first()
    citizen = create_user(session, role=UserRole.CITIZEN, email="cit_fake_img@example.com")

    fake_text = io.BytesIO(b"Not an image file at all")
    data = {
        "categoryId": str(category.id),
        "zoneId": str(zone.id),
        "latitude": "12.9716",
        "longitude": "77.5946",
        "photos": (fake_text, "fake.jpg", "image/jpeg"),
    }

    res = client.post(
        f"{API_PREFIX}/complaints",
        data=data,
        headers=auth_header(citizen),
        content_type="multipart/form-data",
    )
    assert res.status_code == 400


def test_create_complaint_photo_count_bounds(seeded_app, client, session, auth_header):
    zone = session.query(Zone).first()
    category = session.query(ComplaintCategory).first()
    citizen = create_user(session, role=UserRole.CITIZEN, email="cit_photo_bounds@example.com")

    # Zero photos -> 400
    data_zero = {
        "categoryId": str(category.id),
        "zoneId": str(zone.id),
        "latitude": "12.9716",
        "longitude": "77.5946",
    }
    res0 = client.post(
        f"{API_PREFIX}/complaints",
        data=data_zero,
        headers=auth_header(citizen),
        content_type="multipart/form-data",
    )
    assert res0.status_code == 400


def test_get_my_complaints(seeded_app, client, session, auth_header):
    zone = session.query(Zone).first()
    category = session.query(ComplaintCategory).first()
    citizen = create_user(session, role=UserRole.CITIZEN, email="my_cit@example.com")

    fake_jpeg = io.BytesIO(
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00\x48\x00\x48\x00\x00\xff\xfeTestImageBytes"
    )
    data = {
        "categoryId": str(category.id),
        "zoneId": str(zone.id),
        "latitude": "12.9716",
        "longitude": "77.5946",
        "description": "Complaint 1 for dashboard",
        "photos": (fake_jpeg, "test.jpg", "image/jpeg"),
    }
    client.post(
        f"{API_PREFIX}/complaints",
        data=data,
        headers=auth_header(citizen),
        content_type="multipart/form-data",
    )

    res = client.get(f"{API_PREFIX}/complaints/my", headers=auth_header(citizen))
    assert res.status_code == 200
    res_data = res.get_json()

    assert "data" in res_data
    assert "pagination" in res_data
    assert len(res_data["data"]) >= 1
    assert "reporter" not in res_data["data"][0]


def test_get_complaint_by_id_access(seeded_app, client, session, auth_header):
    zone = session.query(Zone).first()
    category = session.query(ComplaintCategory).first()

    owner = create_user(session, role=UserRole.CITIZEN, email="owner@example.com")
    other = create_user(session, role=UserRole.CITIZEN, email="other_cit@example.com")
    officer = create_user(
        session, role=UserRole.OFFICER, email="off_same_zone@example.com", zone_id=zone.id
    )

    fake_jpeg = io.BytesIO(
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00\x48\x00\x48\x00\x00\xff\xfeTestImageBytes"
    )
    data = {
        "categoryId": str(category.id),
        "zoneId": str(zone.id),
        "latitude": "12.9716",
        "longitude": "77.5946",
        "description": "Access test complaint",
        "photos": (fake_jpeg, "test.jpg", "image/jpeg"),
    }
    res_create = client.post(
        f"{API_PREFIX}/complaints",
        data=data,
        headers=auth_header(owner),
        content_type="multipart/form-data",
    )
    complaint_id = res_create.get_json()["id"]

    # 1. Owner gets 200 OK without reporter field
    res_owner = client.get(
        f"{API_PREFIX}/complaints/{complaint_id}", headers=auth_header(owner)
    )
    assert res_owner.status_code == 200
    assert "reporter" not in res_owner.get_json()

    # 2. Other citizen gets 403 Forbidden
    res_other = client.get(
        f"{API_PREFIX}/complaints/{complaint_id}", headers=auth_header(other)
    )
    assert res_other.status_code == 403

    # 3. Officer in same zone gets 200 OK without reporter field
    res_officer = client.get(
        f"{API_PREFIX}/complaints/{complaint_id}", headers=auth_header(officer)
    )
    assert res_officer.status_code == 200
    assert "reporter" not in res_officer.get_json()


def test_get_complaint_by_id_not_found_returns_404(seeded_app, client, session, auth_header):
    citizen = create_user(session, role=UserRole.CITIZEN, email="cit_404@example.com")
    res = client.get(f"{API_PREFIX}/complaints/99999", headers=auth_header(citizen))
    assert res.status_code == 404


def test_admin_gets_reporter_identity(seeded_app, client, session, auth_header):
    zone = session.query(Zone).first()
    category = session.query(ComplaintCategory).first()

    citizen = create_user(
        session, role=UserRole.CITIZEN, email="reporter_c@example.com", name="Jane Reporter"
    )
    admin = create_user(session, role=UserRole.ADMIN, email="admin_rep@example.com")

    fake_jpeg = io.BytesIO(
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00\x48\x00\x48\x00\x00\xff\xfeTestImageBytes"
    )
    data = {
        "categoryId": str(category.id),
        "zoneId": str(zone.id),
        "latitude": "12.9716",
        "longitude": "77.5946",
        "photos": (fake_jpeg, "test.jpg", "image/jpeg"),
    }
    res_create = client.post(
        f"{API_PREFIX}/complaints",
        data=data,
        headers=auth_header(citizen),
        content_type="multipart/form-data",
    )
    complaint_id = res_create.get_json()["id"]

    # Admin gets 200 OK WITH reporter field
    res_admin = client.get(
        f"{API_PREFIX}/complaints/{complaint_id}", headers=auth_header(admin)
    )
    assert res_admin.status_code == 200
    admin_json = res_admin.get_json()
    assert "reporter" in admin_json
    assert admin_json["reporter"]["email"] == "reporter_c@example.com"
