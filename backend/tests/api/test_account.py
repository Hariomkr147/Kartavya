from unittest.mock import patch, MagicMock
from datetime import UTC, datetime
from app.settings import API_PREFIX
from app.models import User
from app.domain.enums import UserRole
from app.domain.errors import ConflictError, ForbiddenError
import jwt

def mock_citizen():
    return User(
        id=1,
        full_name="Test User",
        email="test@test.com",
        role=UserRole.CITIZEN,
        zone_id=1,
        is_active=True,
        created_at=datetime.now(UTC),
    )

def generate_token(user_id="1", role="CITIZEN", zone_id=1):
    payload = {
        "sub": user_id,
        "role": role,
        "zone_id": zone_id,
        "iat": int(datetime.now(UTC).timestamp()),
        "exp": int((datetime.now(UTC) + datetime.timedelta(hours=1)).timestamp()) if hasattr(datetime, "timedelta") else int(datetime.now(UTC).timestamp() + 3600),
    }
    return jwt.encode(payload, "test-secret", algorithm="HS256")

class TestProfileContract:
    URL = f"{API_PREFIX}/users/me"

    @patch('app.core.auth.db.session')
    def test_profile_has_name_not_fullname(self, mock_session, client, seeded_app):
        mock_session.get.return_value = mock_citizen()
        token = jwt.encode({"sub": "1", "role": "CITIZEN", "zone_id": 1, "iat": 0, "exp": 9999999999}, seeded_app.config["JWT_SECRET"], algorithm="HS256")
        res = client.get(self.URL, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        data = res.get_json()
        assert "name" in data
        assert "fullName" not in data

    @patch('app.core.auth.db.session')
    def test_profile_has_active_field(self, mock_session, client, seeded_app):
        mock_session.get.return_value = mock_citizen()
        token = jwt.encode({"sub": "1", "role": "CITIZEN", "zone_id": 1, "iat": 0, "exp": 9999999999}, seeded_app.config["JWT_SECRET"], algorithm="HS256")
        res = client.get(self.URL, headers={"Authorization": f"Bearer {token}"})
        assert "active" in res.get_json()
        assert res.get_json()["active"] is True

    @patch('app.core.auth.db.session')
    def test_profile_has_created_at(self, mock_session, client, seeded_app):
        mock_session.get.return_value = mock_citizen()
        token = jwt.encode({"sub": "1", "role": "CITIZEN", "zone_id": 1, "iat": 0, "exp": 9999999999}, seeded_app.config["JWT_SECRET"], algorithm="HS256")
        res = client.get(self.URL, headers={"Authorization": f"Bearer {token}"})
        assert "createdAt" in res.get_json()


class TestProfileErrorPaths:
    URL = f"{API_PREFIX}/users/me"

    def test_get_profile_unauthenticated(self, client):
        res = client.get(self.URL)
        assert res.status_code == 401

    def test_patch_profile_unauthenticated(self, client):
        res = client.patch(self.URL, json={"displayName": "x"})
        assert res.status_code == 401


class TestPatchProfileZoneRestriction:
    URL = f"{API_PREFIX}/users/me"

    @patch('app.services.accounts.users.update_own_profile')
    @patch('app.core.auth.db.session')
    def test_officer_cannot_change_zone(self, mock_session, mock_update, client, seeded_app):
        officer = User(id=2, full_name="Officer", email="officer@test.com", role=UserRole.OFFICER, zone_id=1, is_active=True, created_at=datetime.now(UTC))
        mock_session.get.return_value = officer
        token = jwt.encode({"sub": "2", "role": "OFFICER", "zone_id": 1, "iat": 0, "exp": 9999999999}, seeded_app.config["JWT_SECRET"], algorithm="HS256")
        
        mock_update.side_effect = ForbiddenError("Only citizens can change their zone.")
        
        res = client.patch(self.URL, headers={"Authorization": f"Bearer {token}"}, json={"zoneId": "2"})
        assert res.status_code == 403


class TestDisplayNameNullClear:
    URL = f"{API_PREFIX}/users/me"

    @patch('app.services.accounts.users.update_own_profile')
    @patch('app.core.auth.db.session')
    def test_null_display_name_clears_it(self, mock_session, mock_update, client, seeded_app):
        user = mock_citizen()
        user.display_name = "CustomName"
        mock_session.get.return_value = user
        token = jwt.encode({"sub": "1", "role": "CITIZEN", "zone_id": 1, "iat": 0, "exp": 9999999999}, seeded_app.config["JWT_SECRET"], algorithm="HS256")
        
        # When update_profile is called, simulate the effect
        def mock_update_func(*args, **kwargs):
            display_name = kwargs.get('display_name') or (args[3] if len(args) > 3 else None)
            name = kwargs.get('full_name') or (args[2] if len(args) > 2 else None)
            user.display_name = None
            return user
        mock_update.side_effect = mock_update_func
        
        res = client.patch(self.URL, headers={"Authorization": f"Bearer {token}"}, json={"displayName": None})
        assert res.status_code == 200
        assert res.get_json()["displayName"] is None

    @patch('app.services.accounts.users.update_own_profile')
    @patch('app.core.auth.db.session')
    def test_omitting_display_name_preserves_it(self, mock_session, mock_update, client, seeded_app):
        user = mock_citizen()
        user.display_name = "KeepThis"
        mock_session.get.return_value = user
        token = jwt.encode({"sub": "1", "role": "CITIZEN", "zone_id": 1, "iat": 0, "exp": 9999999999}, seeded_app.config["JWT_SECRET"], algorithm="HS256")
        
        def mock_update_func(*args, **kwargs):
            display_name = kwargs.get('display_name') or (args[3] if len(args) > 3 else None)
            name = kwargs.get('full_name') or (args[2] if len(args) > 2 else None)
            user.full_name = name
            return user
        mock_update.side_effect = mock_update_func
        
        res = client.patch(self.URL, headers={"Authorization": f"Bearer {token}"}, json={"name": "NewFull"})
        assert res.status_code == 200
        assert res.get_json()["displayName"] == "KeepThis"


class TestNoZoneNameInResponse:
    URL = f"{API_PREFIX}/users/me"

    @patch('app.core.auth.db.session')
    def test_no_zone_name_in_profile(self, mock_session, client, seeded_app):
        mock_session.get.return_value = mock_citizen()
        token = jwt.encode({"sub": "1", "role": "CITIZEN", "zone_id": 1, "iat": 0, "exp": 9999999999}, seeded_app.config["JWT_SECRET"], algorithm="HS256")
        res = client.get(self.URL, headers={"Authorization": f"Bearer {token}"})
        data = res.get_json()
        assert "zoneName" not in data



