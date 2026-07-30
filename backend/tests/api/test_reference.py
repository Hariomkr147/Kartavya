from __future__ import annotations
import pytest
from app.settings import API_PREFIX

def test_get_categories(client, seeded_app):
    res = client.get(f"{API_PREFIX}/categories")
    assert res.status_code == 200
    assert len(res.get_json()) == 12

def test_get_zones(client, seeded_app):
    res = client.get(f"{API_PREFIX}/zones")
    assert res.status_code == 200
    assert len(res.get_json()) == 1 # only the catch_all is seeded by default

def test_suggest_zone(client, seeded_app, auth_header):
    from app.models import User
    from app.domain.enums import UserRole
    from werkzeug.security import generate_password_hash
    from datetime import datetime, UTC
    from app.extensions import db
    
    user = User(
        full_name="User",
        email="u@test.com",
        password_hash=generate_password_hash("pass"),
        role=UserRole.CITIZEN,
        zone_id=1,
        created_at=datetime.now(UTC)
    )
    db.session.add(user)
    db.session.commit()
    headers = auth_header(user)

    res = client.post(f"{API_PREFIX}/zones/suggest", headers=headers, json={
        "latitude": 0.0,
        "longitude": 0.0
    })
    assert res.status_code == 200
    assert "suggestedZone" in res.get_json()


class TestCategoryContract:
    URL = f"{API_PREFIX}/categories"

    def test_category_has_required_fields(self, client, seeded_app):
        res = client.get(self.URL)
        assert res.status_code == 200
        cat = res.get_json()[0]
        for field in ("id", "code", "name", "slaTargetHours"):
            assert field in cat, f"Category missing required field: {field}"


class TestZoneContract:
    URL = f"{API_PREFIX}/zones"

    def test_zone_has_required_fields(self, client, seeded_app):
        res = client.get(self.URL)
        assert res.status_code == 200
        zone = res.get_json()[0]
        for field in ("id", "code", "name", "isCatchAll", "isActive"):
            assert field in zone, f"Zone missing required field: {field}"


class TestSuggestZoneContract:
    URL = f"{API_PREFIX}/zones/suggest"

    def test_suggest_zone_missing_coordinates(self, client, seeded_app, auth_header):
        from app.models import User
        from app.domain.enums import UserRole
        from werkzeug.security import generate_password_hash
        from datetime import datetime, UTC
        from app.extensions import db

        user = User(
            full_name="SuggestUser",
            email="suggest2@test.com",
            password_hash=generate_password_hash("pass"),
            role=UserRole.CITIZEN,
            zone_id=1,
            created_at=datetime.now(UTC),
        )
        db.session.add(user)
        db.session.commit()
        headers = auth_header(user)

        res = client.post(self.URL, headers=headers, json={})
        assert res.status_code == 400
