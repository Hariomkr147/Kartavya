from __future__ import annotations
import pytest
from app.settings import API_PREFIX

@pytest.fixture
def auth_user(session):
    from app.models import User, Zone
    from app.domain.enums import UserRole
    from werkzeug.security import generate_password_hash
    from datetime import datetime, UTC
    
    zone = Zone(zone_code="Z_acc", zone_name="Z", center_lat=0.0, center_lng=0.0)
    session.add(zone)
    session.flush()
    user = User(
        full_name="Full Name",
        email="me@test.com",
        password_hash=generate_password_hash("password"),
        role=UserRole.CITIZEN,
        zone_id=zone.id,
        created_at=datetime.now(UTC)
    )
    session.add(user)
    session.commit()
    return user

def test_get_my_profile(client, auth_user, auth_header):
    headers = auth_header(auth_user)
    res = client.get(f"{API_PREFIX}/users/me", headers=headers)
    assert res.status_code == 200
    data = res.get_json()
    assert data["email"] == "me@test.com"

def test_update_my_profile(client, auth_user, auth_header):
    headers = auth_header(auth_user)
    res = client.patch(f"{API_PREFIX}/users/me", headers=headers, json={
        "displayName": "New Name"
    })
    assert res.status_code == 200
    assert res.get_json()["displayName"] == "New Name"

def test_change_password(client, auth_user, auth_header):
    headers = auth_header(auth_user)
    res = client.post(f"{API_PREFIX}/users/me/change-password", headers=headers, json={
        "currentPassword": "password",
        "newPassword": "newpassword123"
    })
    assert res.status_code == 204
    
    # Verify new password
    res2 = client.post(f"{API_PREFIX}/auth/login", json={
        "email": auth_user.email,
        "password": "newpassword123"
    })
    assert res2.status_code == 200


class TestProfileContract:
    """Verify User response schema matches the OpenAPI contract."""
    URL = f"{API_PREFIX}/users/me"

    def test_profile_has_name_not_fullname(self, client, auth_user, auth_header):
        headers = auth_header(auth_user)
        res = client.get(self.URL, headers=headers)
        data = res.get_json()
        assert "name" in data, "User must have 'name' field"
        assert "fullName" not in data, "User must not have 'fullName'"

    def test_profile_has_active_field(self, client, auth_user, auth_header):
        headers = auth_header(auth_user)
        res = client.get(self.URL, headers=headers)
        data = res.get_json()
        assert "active" in data
        assert data["active"] is True

    def test_profile_has_created_at(self, client, auth_user, auth_header):
        headers = auth_header(auth_user)
        res = client.get(self.URL, headers=headers)
        assert "createdAt" in res.get_json()


class TestProfileErrorPaths:
    URL = f"{API_PREFIX}/users/me"

    def test_get_profile_unauthenticated(self, client, seeded_app):
        res = client.get(self.URL)
        assert res.status_code == 401

    def test_patch_profile_unauthenticated(self, client, seeded_app):
        res = client.patch(self.URL, json={"displayName": "x"})
        assert res.status_code == 401


class TestPatchProfileZoneRestriction:
    """Officers cannot change their own zone — that is an admin-only action."""
    URL = f"{API_PREFIX}/users/me"

    def test_officer_cannot_change_zone(self, client, session, seeded_app, auth_header):
        from app.models import User, Zone
        from app.domain.enums import UserRole
        from werkzeug.security import generate_password_hash
        from datetime import datetime, UTC

        zone = Zone.query.first()
        officer = User(
            full_name="Officer",
            email="officer_zone@test.com",
            password_hash=generate_password_hash("password"),
            role=UserRole.OFFICER,
            zone_id=zone.id,
            created_at=datetime.now(UTC),
        )
        session.add(officer)
        session.commit()

        headers = auth_header(officer)
        res = client.patch(self.URL, headers=headers, json={"zoneId": str(zone.id)})
        assert res.status_code == 403
