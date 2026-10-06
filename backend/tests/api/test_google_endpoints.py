"""Google sign-in over HTTP, with the real verifier and locally signed tokens."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.core.auth import issue_token
from app.domain.enums import UserRole
from app.extensions import db
from app.models import Zone
from app.settings import API_PREFIX
from tests import google_support as gs
from tests.mfa_support import PASSWORD, enable_totp, make_user

GOOGLE = f"{API_PREFIX}/auth/google"
ME = f"{API_PREFIX}/users/me"
LOGIN = f"{API_PREFIX}/auth/login"


@pytest.fixture(autouse=True)
def _google_on(app, monkeypatch):
    gs.install(app, monkeypatch)


@pytest.fixture
def zone(app):
    z = Zone(zone_code="Z1", zone_name="One", center_lat=1.0, center_lng=1.0)
    db.session.add(z)
    db.session.commit()
    return z


def _bearer(user):
    return {"Authorization": f"Bearer {issue_token(user)[0]}"}


def test_sign_up_then_sign_in(client, zone):
    token = gs.id_token()
    first = client.post(GOOGLE, json={"idToken": token, "zoneId": str(zone.id)})
    assert first.status_code == 201
    body = first.get_json()
    assert set(body) == {"token", "tokenType", "expiresAt", "user"}
    user = body["user"]
    assert user["role"] == "CITIZEN" and user["hasPassword"] is False
    assert user["googleLinked"] is True and user["email"] == "asha@example.com"
    assert client.get(ME, headers={"Authorization": f"Bearer {body['token']}"}).status_code == 200

    again = client.post(GOOGLE, json={"idToken": gs.id_token()})
    assert again.status_code == 200 and again.get_json()["user"]["id"] == user["id"]


def test_new_account_needs_a_zone_and_the_same_token_works_on_retry(client, zone):
    token = gs.id_token()
    res = client.post(GOOGLE, json={"idToken": token})
    assert res.status_code == 409 and res.get_json()["error"]["code"] == "ZONE_REQUIRED"
    retry = client.post(GOOGLE, json={"idToken": token, "zoneId": str(zone.id)})
    assert retry.status_code == 201


def test_bad_tokens_are_401_and_bodies_are_validated(client):
    for token in (
        gs.id_token(aud="another-app"),
        gs.id_token(email_verified=False),
        gs.id_token(signed_by_google=False),
        "junk",
    ):
        assert client.post(GOOGLE, json={"idToken": token}).status_code == 401
    assert client.post(GOOGLE, json={}).status_code == 400
    assert client.post(GOOGLE, json={"idToken": ""}).status_code == 400
    assert client.post(GOOGLE, json={"idToken": "x", "surprise": 1}).status_code == 400


def test_staff_email_is_403_until_they_link_from_their_account(client):
    officer = make_user(email="asha@example.com", role=UserRole.OFFICER)
    res = client.post(GOOGLE, json={"idToken": gs.id_token()})
    assert res.status_code == 403
    assert res.get_json()["error"]["code"] == "GOOGLE_LINK_REQUIRED"

    linked = client.post(f"{ME}/google", json={"idToken": gs.id_token()}, headers=_bearer(officer))
    assert linked.status_code == 200 and linked.get_json()["googleLinked"] is True
    assert client.post(GOOGLE, json={"idToken": gs.id_token()}).status_code == 200


def test_google_users_still_pass_the_second_step(client):
    citizen = make_user()
    enable_totp(citizen, datetime.now(UTC))
    res = client.post(GOOGLE, json={"idToken": gs.id_token()})
    assert res.status_code == 202
    body = res.get_json()
    assert set(body) == {"mfaRequired", "mfaTicket", "method", "expiresAt"}


def test_a_google_only_account_cannot_use_password_login(client, zone):
    client.post(GOOGLE, json={"idToken": gs.id_token(), "zoneId": str(zone.id)})
    for password in (PASSWORD, "", "!"):
        res = client.post(LOGIN, json={"email": "asha@example.com", "password": password or "x"})
        assert res.status_code == 401
        assert res.get_json()["error"]["message"] == "Invalid email or password."


def test_link_unlink_over_http(client):
    user = make_user()
    h = _bearer(user)
    other = make_user(email="other@example.com")

    assert client.delete(f"{ME}/google", headers=h).status_code == 409  # nothing linked
    assert (
        client.post(f"{ME}/google", json={"idToken": gs.id_token()}, headers=h).status_code == 200
    )
    assert (
        client.post(f"{ME}/google", json={"idToken": gs.id_token()}, headers=h).status_code == 409
    )
    conflict = client.post(f"{ME}/google", json={"idToken": gs.id_token()}, headers=_bearer(other))
    assert conflict.status_code == 409  # that Google account is taken
    assert client.delete(f"{ME}/google", headers=h).status_code == 204
    assert client.get(ME, headers=h).get_json()["googleLinked"] is False
    assert client.post(f"{ME}/google", json={"idToken": gs.id_token()}).status_code == 401


def test_unlink_is_refused_for_a_google_only_account(client, zone):
    body = client.post(GOOGLE, json={"idToken": gs.id_token(), "zoneId": str(zone.id)}).get_json()
    res = client.delete(f"{ME}/google", headers={"Authorization": f"Bearer {body['token']}"})
    assert res.status_code == 409 and res.get_json()["error"]["code"] == "NO_OTHER_LOGIN"


def test_503_when_google_is_not_configured_and_nothing_else_is_affected(app, client):
    app.config["GOOGLE_CLIENT_ID"] = ""
    user = make_user()
    for method, url, kw in [
        ("POST", GOOGLE, {"json": {"idToken": "x"}}),
        ("POST", f"{ME}/google", {"json": {"idToken": "x"}, "headers": _bearer(user)}),
    ]:
        res = client.open(url, method=method, **kw)
        assert res.status_code == 503
        assert res.get_json()["error"]["code"] == "GOOGLE_NOT_CONFIGURED"
    assert client.post(LOGIN, json={"email": user.email, "password": PASSWORD}).status_code == 200


def test_google_id_never_appears_in_a_response(client, zone):
    res = client.post(GOOGLE, json={"idToken": gs.id_token(), "zoneId": str(zone.id)})
    assert "google-sub-1" not in res.get_data(as_text=True)
    token = res.get_json()["token"]
    me = client.get(ME, headers={"Authorization": f"Bearer {token}"})
    assert "google-sub-1" not in me.get_data(as_text=True)
    assert "google_sub" not in me.get_data(as_text=True)
