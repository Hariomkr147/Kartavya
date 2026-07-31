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

    def test_admin_cannot_change_zone(self, client, session, seeded_app, auth_header):
        from app.models import User, Zone
        from app.domain.enums import UserRole
        from werkzeug.security import generate_password_hash
        from datetime import datetime, UTC

        zone = Zone.query.first()
        admin = User(
            full_name="Admin",
            email="admin_zone@test.com",
            password_hash=generate_password_hash("password"),
            role=UserRole.ADMIN,
            zone_id=None,
            created_at=datetime.now(UTC),
        )
        session.add(admin)
        session.commit()

        headers = auth_header(admin)
        res = client.patch(self.URL, headers=headers, json={"zoneId": str(zone.id)})
        assert res.status_code == 403


class TestDisplayNameNullClear:
    """Sending displayName: null should clear it, not silently ignore it."""
    URL = f"{API_PREFIX}/users/me"

    def test_null_display_name_clears_it(self, client, session, app, auth_header):
        from app.models import User, Zone
        from app.domain.enums import UserRole
        from werkzeug.security import generate_password_hash
        from datetime import datetime, UTC

        zone = Zone(zone_code="Z_dn", zone_name="DN", center_lat=0.0, center_lng=0.0)
        session.add(zone)
        session.flush()
        user = User(
            full_name="ClearMe",
            email="cleardisplay@test.com",
            password_hash=generate_password_hash("password"),
            role=UserRole.CITIZEN,
            zone_id=zone.id,
            display_name="CustomName",
            created_at=datetime.now(UTC),
        )
        session.add(user)
        session.commit()

        headers = auth_header(user)

        # First verify it's set.
        res = client.get(self.URL, headers=headers)
        assert res.get_json()["displayName"] == "CustomName"

        # Now send null to clear.
        res = client.patch(self.URL, headers=headers, json={"displayName": None})
        assert res.status_code == 200
        assert res.get_json()["displayName"] is None

    def test_omitting_display_name_preserves_it(self, client, session, app, auth_header):
        from app.models import User, Zone
        from app.domain.enums import UserRole
        from werkzeug.security import generate_password_hash
        from datetime import datetime, UTC

        zone = Zone(zone_code="Z_pres", zone_name="Pres", center_lat=0.0, center_lng=0.0)
        session.add(zone)
        session.flush()
        user = User(
            full_name="PreserveMe",
            email="preserve@test.com",
            password_hash=generate_password_hash("password"),
            role=UserRole.CITIZEN,
            zone_id=zone.id,
            display_name="KeepThis",
            created_at=datetime.now(UTC),
        )
        session.add(user)
        session.commit()

        headers = auth_header(user)

        # PATCH without displayName — should keep existing value.
        res = client.patch(self.URL, headers=headers, json={"name": "NewFull"})
        assert res.status_code == 200
        assert res.get_json()["displayName"] == "KeepThis"


class TestBadZoneIdRegister:
    """Registering with a non-existent zoneId should return 400, not 500."""
    URL = f"{API_PREFIX}/auth/register"

    def test_register_nonexistent_zone(self, client, seeded_app):
        res = client.post(self.URL, json={
            "name": "Ghost Zone",
            "email": "ghost@test.com",
            "password": "password123",
            "zoneId": "99999",
        })
        assert res.status_code == 400


class TestEmailCaseInsensitive:
    """Email uniqueness must be case-insensitive."""

    def test_register_case_insensitive_duplicate(self, client, session, app):
        from app.models import User, Zone
        from app.domain.enums import UserRole
        from werkzeug.security import generate_password_hash
        from datetime import datetime, UTC

        zone = Zone(zone_code="Z_ci", zone_name="CI", center_lat=0.0, center_lng=0.0)
        session.add(zone)
        session.flush()

        user = User(
            full_name="Case",
            email="case@test.com",
            password_hash=generate_password_hash("password"),
            role=UserRole.CITIZEN,
            zone_id=zone.id,
            created_at=datetime.now(UTC),
        )
        session.add(user)
        session.commit()

        res = client.post(f"{API_PREFIX}/auth/register", json={
            "name": "Case Upper",
            "email": "CASE@TEST.COM",
            "password": "password123",
            "zoneId": str(zone.id),
        })
        assert res.status_code == 409

    def test_login_case_insensitive(self, client, session, app):
        from app.models import User, Zone
        from app.domain.enums import UserRole
        from werkzeug.security import generate_password_hash
        from datetime import datetime, UTC

        zone = Zone(zone_code="Z_ci2", zone_name="CI2", center_lat=0.0, center_lng=0.0)
        session.add(zone)
        session.flush()

        user = User(
            full_name="LoginCase",
            email="logincase@test.com",
            password_hash=generate_password_hash("password"),
            role=UserRole.CITIZEN,
            zone_id=zone.id,
            created_at=datetime.now(UTC),
        )
        session.add(user)
        session.commit()

        res = client.post(f"{API_PREFIX}/auth/login", json={
            "email": "LOGINCASE@TEST.COM",
            "password": "password",
        })
        assert res.status_code == 200


class TestNoZoneNameInResponse:
    """The contract does not include zoneName — verify it's absent."""
    URL = f"{API_PREFIX}/users/me"

    def test_no_zone_name_in_profile(self, client, auth_user, auth_header):
        headers = auth_header(auth_user)
        res = client.get(self.URL, headers=headers)
        data = res.get_json()
        assert "zoneName" not in data, "zoneName is not in the API contract"
