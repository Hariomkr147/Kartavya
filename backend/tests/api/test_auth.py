from __future__ import annotations

import pytest
from app.settings import API_PREFIX
from app.models import User
from app.domain.enums import UserRole
from werkzeug.security import generate_password_hash
from datetime import datetime, UTC

@pytest.fixture
def test_zone(session):
    from app.models import Zone
    zone = Zone(zone_code="Z1", zone_name="Zone 1", center_lat=0.0, center_lng=0.0)
    session.add(zone)
    session.commit()
    return zone

@pytest.fixture
def test_user(session, test_zone):
    user = User(
        full_name="Existing User",
        email="existing@test.com",
        password_hash=generate_password_hash("password"),
        role=UserRole.CITIZEN,
        zone_id=test_zone.id,
        created_at=datetime.now(UTC)
    )
    session.add(user)
    session.commit()
    return user

def test_register_citizen_success(client, test_zone):
    res = client.post(f"{API_PREFIX}/auth/register", json={
        "name": "New User",
        "email": "new@test.com",
        "password": "password123",
        "zoneId": str(test_zone.id)
    })
    assert res.status_code == 201
    data = res.get_json()
    assert "token" in data
    assert data["user"]["email"] == "new@test.com"
    assert data["user"]["role"] == "CITIZEN"

def test_register_citizen_duplicate_email(client, test_user, test_zone):
    res = client.post(f"{API_PREFIX}/auth/register", json={
        "name": "Another User",
        "email": test_user.email,
        "password": "password123",
        "zoneId": str(test_zone.id)
    })
    assert res.status_code == 409
    assert res.get_json()["error"]["code"] == "EMAIL_TAKEN"

def test_login_success(client, test_user):
    res = client.post(f"{API_PREFIX}/auth/login", json={
        "email": test_user.email,
        "password": "password"
    })
    assert res.status_code == 200
    assert "token" in res.get_json()

def test_login_failure(client, test_user):
    res = client.post(f"{API_PREFIX}/auth/login", json={
        "email": test_user.email,
        "password": "wrong"
    })
    assert res.status_code == 401


class TestRegisterContract:
    """Verify AuthResponse matches the OpenAPI contract exactly."""
    URL = f"{API_PREFIX}/auth/register"

    def test_register_response_has_token_type(self, client, test_zone):
        res = client.post(self.URL, json={
            "name": "Token Type",
            "email": "tokentype@test.com",
            "password": "password123",
            "zoneId": str(test_zone.id),
        })
        assert res.status_code == 201
        data = res.get_json()
        assert data["tokenType"] == "Bearer"

    def test_register_user_has_name_not_fullname(self, client, test_zone):
        res = client.post(self.URL, json={
            "name": "Name Field",
            "email": "namefield@test.com",
            "password": "password123",
            "zoneId": str(test_zone.id),
        })
        assert res.status_code == 201
        user = res.get_json()["user"]
        assert "name" in user, "User should have 'name', not 'fullName'"
        assert "fullName" not in user
        assert user["name"] == "Name Field"

    def test_register_user_has_active_field(self, client, test_zone):
        res = client.post(self.URL, json={
            "name": "Active Field",
            "email": "activefield@test.com",
            "password": "password123",
            "zoneId": str(test_zone.id),
        })
        assert res.status_code == 201
        user = res.get_json()["user"]
        assert "active" in user, "User must include 'active' field"
        assert user["active"] is True

    def test_register_response_has_expires_at(self, client, test_zone):
        res = client.post(self.URL, json={
            "name": "Expires At",
            "email": "expat@test.com",
            "password": "password123",
            "zoneId": str(test_zone.id),
        })
        assert res.status_code == 201
        assert "expiresAt" in res.get_json()


class TestRegisterValidation:
    """Edge-case validation."""
    URL = f"{API_PREFIX}/auth/register"

    def test_register_missing_name(self, client, test_zone):
        res = client.post(self.URL, json={
            "email": "noname@test.com",
            "password": "password123",
            "zoneId": str(test_zone.id),
        })
        assert res.status_code == 400

    def test_register_short_password(self, client, test_zone):
        res = client.post(self.URL, json={
            "name": "Short Pass",
            "email": "short@test.com",
            "password": "short",
            "zoneId": str(test_zone.id),
        })
        assert res.status_code == 400

    def test_register_invalid_email(self, client, test_zone):
        res = client.post(self.URL, json={
            "name": "Bad Email",
            "email": "not-an-email",
            "password": "password123",
            "zoneId": str(test_zone.id),
        })
        assert res.status_code == 400

    def test_register_role_escalation_ignored(self, client, test_zone):
        """A registration body sneaking in role=ADMIN must be rejected by extra=forbid."""
        res = client.post(self.URL, json={
            "name": "Escalator",
            "email": "escalate@test.com",
            "password": "password123",
            "zoneId": str(test_zone.id),
            "role": "ADMIN",
        })
        # extra="forbid" means unknown field → 400
        assert res.status_code == 400


class TestLoginContract:
    URL = f"{API_PREFIX}/auth/login"

    def test_login_response_has_token_type(self, client, test_user):
        res = client.post(self.URL, json={
            "email": test_user.email,
            "password": "password",
        })
        assert res.status_code == 200
        assert res.get_json()["tokenType"] == "Bearer"

    def test_login_deactivated_returns_401(self, client, session, test_zone):
        """The contract says deactivated accounts are rejected at login with 401."""
        from app.models import User
        from app.domain.enums import UserRole
        from werkzeug.security import generate_password_hash
        from datetime import datetime, UTC

        user = User(
            full_name="Inactive",
            email="inactive@test.com",
            password_hash=generate_password_hash("password"),
            role=UserRole.CITIZEN,
            zone_id=test_zone.id,
            is_active=False,
            created_at=datetime.now(UTC),
        )
        session.add(user)
        session.commit()

        res = client.post(self.URL, json={
            "email": "inactive@test.com",
            "password": "password",
        })
        assert res.status_code == 401
