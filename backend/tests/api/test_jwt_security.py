"""JWT edge-case and security tests.

These verify that the authentication layer rejects bad tokens immediately,
which is the security foundation for every authenticated endpoint.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.settings import API_PREFIX


class TestExpiredToken:
    """An expired token must return 401."""

    def test_expired_token_returns_401(self, client, seeded_app, session):
        from app.models import User
        from app.domain.enums import UserRole
        from werkzeug.security import generate_password_hash
        from app.extensions import db

        user = User(
            full_name="Expired",
            email="expired@test.com",
            password_hash=generate_password_hash("pass"),
            role=UserRole.CITIZEN,
            zone_id=1,
            created_at=datetime.now(UTC),
        )
        db.session.add(user)
        db.session.commit()

        # Mint a token that expired 1 hour ago.
        now = datetime.now(UTC)
        payload = {
            "sub": str(user.id),
            "role": "CITIZEN",
            "zone_id": user.zone_id,
            "iat": int((now - timedelta(hours=2)).timestamp()),
            "exp": int((now - timedelta(hours=1)).timestamp()),
        }
        token = jwt.encode(payload, seeded_app.config["JWT_SECRET"], algorithm="HS256")
        headers = {"Authorization": f"Bearer {token}"}

        res = client.get(f"{API_PREFIX}/users/me", headers=headers)
        assert res.status_code == 401


class TestMalformedToken:
    """Junk strings must not crash the server."""

    def test_garbage_token_returns_401(self, client, seeded_app):
        headers = {"Authorization": "Bearer not-a-real-jwt"}
        res = client.get(f"{API_PREFIX}/users/me", headers=headers)
        assert res.status_code == 401

    def test_empty_bearer_returns_401(self, client, seeded_app):
        headers = {"Authorization": "Bearer "}
        res = client.get(f"{API_PREFIX}/users/me", headers=headers)
        assert res.status_code == 401

    def test_missing_auth_header_returns_401(self, client, seeded_app):
        res = client.get(f"{API_PREFIX}/users/me")
        assert res.status_code == 401


class TestWrongSecret:
    """A token signed with the wrong key must be rejected."""

    def test_wrong_secret_returns_401(self, client, seeded_app, session):
        from app.models import User
        from app.domain.enums import UserRole
        from werkzeug.security import generate_password_hash
        from app.extensions import db

        user = User(
            full_name="Wrong",
            email="wrong@test.com",
            password_hash=generate_password_hash("pass"),
            role=UserRole.CITIZEN,
            zone_id=1,
            created_at=datetime.now(UTC),
        )
        db.session.add(user)
        db.session.commit()

        now = datetime.now(UTC)
        payload = {
            "sub": str(user.id),
            "role": "CITIZEN",
            "zone_id": user.zone_id,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=1)).timestamp()),
        }
        token = jwt.encode(payload, "totally-wrong-secret", algorithm="HS256")
        headers = {"Authorization": f"Bearer {token}"}

        res = client.get(f"{API_PREFIX}/users/me", headers=headers)
        assert res.status_code == 401


class TestDeactivatedUser:
    """Rule 5: a deactivated user is blocked even with a valid token."""

    def test_deactivated_user_returns_401(self, client, seeded_app, auth_header, session):
        from app.models import User
        from app.domain.enums import UserRole
        from werkzeug.security import generate_password_hash
        from app.extensions import db

        user = User(
            full_name="Deactivated",
            email="deac@test.com",
            password_hash=generate_password_hash("pass"),
            role=UserRole.CITIZEN,
            zone_id=1,
            is_active=True,
            created_at=datetime.now(UTC),
        )
        db.session.add(user)
        db.session.commit()

        # Get a valid token while active.
        headers = auth_header(user)

        # Now deactivate.
        user.is_active = False
        db.session.commit()

        res = client.get(f"{API_PREFIX}/users/me", headers=headers)
        assert res.status_code == 401
