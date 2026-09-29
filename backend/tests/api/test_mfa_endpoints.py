"""Two-step verification over HTTP: the wire shapes, and what must NOT change."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt

from app.core.auth import issue_mfa_ticket, issue_token
from app.domain.enums import UserRole
from app.settings import API_PREFIX
from tests.mfa_support import PASSWORD, code_at, enable_totp, make_user, wrong_code

LOGIN = f"{API_PREFIX}/auth/login"
VERIFY = f"{API_PREFIX}/auth/mfa/verify"
ME = f"{API_PREFIX}/users/me"


def _login(client, email="asha@example.com"):
    return client.post(LOGIN, json={"email": email, "password": PASSWORD})


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _now():
    return datetime.now(UTC)


# --- Nothing changes for accounts without 2FA --------------------------------


def test_login_without_2fa_is_exactly_the_response_it_always_was(app, client):
    make_user()
    res = _login(client)
    assert res.status_code == 200
    body = res.get_json()
    assert set(body) == {"token", "tokenType", "expiresAt", "user"}
    assert "mfaRequired" not in body and "mfaTicket" not in body


def test_a_token_from_before_this_release_still_works(app, client):
    """Existing sessions carry no `typ`. They must survive the deploy."""
    user = make_user()
    old_style = jwt.encode(
        {
            "sub": str(user.id),
            "role": "CITIZEN",
            "zone_id": None,
            "iat": int(_now().timestamp()),
            "exp": int((_now() + timedelta(hours=1)).timestamp()),
        },
        app.config["JWT_SECRET"],
        algorithm="HS256",
    )
    assert client.get(ME, headers=_bearer(old_style)).status_code == 200
    token, _ = issue_token(user)  # and today's issue_token() is unchanged too
    assert "typ" not in jwt.decode(token, options={"verify_signature": False})


def test_user_payload_carries_the_new_optional_fields(app, client):
    user = make_user()
    token, _ = issue_token(user)
    body = client.get(ME, headers=_bearer(token)).get_json()
    assert body["mfaEnabled"] is False
    assert body["mfaMethod"] is None
    assert body["mfaRecommended"] is False  # citizens are only ever offered it
    assert body["hasPassword"] is True
    assert body["googleLinked"] is False


def test_staff_are_recommended_2fa_until_they_turn_it_on(app, client):
    officer = make_user(email="o@example.com", role=UserRole.OFFICER)
    # (officers need a zone in real life; the serializer does not care)
    token, _ = issue_token(officer)
    assert client.get(ME, headers=_bearer(token)).get_json()["mfaRecommended"] is True

    enable_totp(officer, _now())
    assert client.get(ME, headers=_bearer(token)).get_json()["mfaRecommended"] is False


# --- Login with 2FA on -------------------------------------------------------


def test_login_with_2fa_answers_202_and_issues_no_session(app, client):
    user = make_user()
    enable_totp(user, _now())
    res = _login(client)
    assert res.status_code == 202
    body = res.get_json()
    assert set(body) == {"mfaRequired", "mfaTicket", "method", "expiresAt"}
    assert body["mfaRequired"] is True and body["method"] == "TOTP"
    assert "token" not in body and "user" not in body


def test_the_ticket_is_not_a_session_on_any_route(app, client):
    user = make_user()
    ticket, _ = issue_mfa_ticket(user)
    for method, path in [
        ("GET", ME),
        ("PATCH", ME),
        ("GET", f"{API_PREFIX}/gamification/points"),
        ("GET", f"{API_PREFIX}/feed"),
        ("POST", f"{API_PREFIX}/users/me/mfa"),
        ("GET", f"{API_PREFIX}/officer/complaints"),
        ("GET", f"{API_PREFIX}/admin/users"),
    ]:
        res = client.open(path, method=method, headers=_bearer(ticket), json={})
        assert res.status_code == 401, (method, path, res.status_code)


def test_a_session_token_cannot_stand_in_for_a_ticket(app, client):
    user = make_user()
    secret = enable_totp(user, _now())
    session_token, _ = issue_token(user)
    res = client.post(VERIFY, json={"mfaTicket": session_token, "code": code_at(secret, _now(), 1)})
    assert res.status_code == 401


def test_full_login_with_a_code(app, client):
    user = make_user()
    secret = enable_totp(user, _now())
    ticket = _login(client).get_json()["mfaTicket"]

    res = client.post(VERIFY, json={"mfaTicket": ticket, "code": code_at(secret, _now(), 1)})
    assert res.status_code == 200
    body = res.get_json()
    assert set(body) == {"token", "tokenType", "expiresAt", "user"}
    assert body["user"]["mfaEnabled"] is True
    assert client.get(ME, headers=_bearer(body["token"])).status_code == 200


def test_wrong_and_malformed_codes(app, client):
    user = make_user()
    secret = enable_totp(user, _now())
    ticket = _login(client).get_json()["mfaTicket"]

    res = client.post(VERIFY, json={"mfaTicket": ticket, "code": wrong_code(secret, _now())})
    assert res.status_code == 401
    assert res.get_json()["error"]["code"] == "INVALID_CODE"

    for bad in ["12345", "1234567", "abcdef", "١٢٣٤٥٦", ""]:
        res = client.post(VERIFY, json={"mfaTicket": ticket, "code": bad})
        assert res.status_code == 400, bad
    res = client.post(VERIFY, json={"mfaTicket": ticket, "code": "123456", "extra": 1})
    assert res.status_code == 400  # extra="forbid", like every other body


def test_expired_and_garbage_tickets_are_401(app, client):
    user = make_user()
    enable_totp(user, _now())
    expired = jwt.encode(
        {
            "sub": str(user.id),
            "typ": "mfa",
            "iat": 0,
            "exp": int((_now() - timedelta(minutes=1)).timestamp()),
        },
        app.config["JWT_SECRET"],
        algorithm="HS256",
    )
    for ticket in (expired, "not-a-jwt"):
        assert client.post(VERIFY, json={"mfaTicket": ticket, "code": "123456"}).status_code == 401


def test_a_code_cannot_be_replayed_over_http(app, client):
    user = make_user()
    secret = enable_totp(user, _now())
    ticket = _login(client).get_json()["mfaTicket"]
    code = code_at(secret, _now(), 1)
    assert client.post(VERIFY, json={"mfaTicket": ticket, "code": code}).status_code == 200
    assert client.post(VERIFY, json={"mfaTicket": ticket, "code": code}).status_code == 401


def test_lockout_is_429_over_http(app, client):
    user = make_user()
    secret = enable_totp(user, _now())
    ticket = _login(client).get_json()["mfaTicket"]
    statuses = [
        client.post(
            VERIFY, json={"mfaTicket": ticket, "code": wrong_code(secret, _now())}
        ).status_code
        for _ in range(5)
    ]
    assert statuses == [401, 401, 401, 401, 429]
    res = client.post(VERIFY, json={"mfaTicket": ticket, "code": code_at(secret, _now(), 1)})
    assert res.status_code == 429
    assert res.get_json()["error"]["code"] == "MFA_LOCKED"


# --- Setup, confirm, disable -------------------------------------------------


def test_setup_confirm_disable_over_http(app, client):
    user = make_user()
    token, _ = issue_token(user)
    h = _bearer(token)

    res = client.post(f"{ME}/mfa", json={"method": "TOTP"}, headers=h)
    assert res.status_code == 201
    setup = res.get_json()
    assert set(setup) == {"method", "otpauthUri", "secret"}
    assert setup["otpauthUri"].startswith("otpauth://totp/Kartavya:")

    # Pending: the profile says off, and the secret is nowhere in it.
    profile = client.get(ME, headers=h).get_json()
    assert profile["mfaEnabled"] is False
    assert setup["secret"] not in str(profile)

    bad = client.post(
        f"{ME}/mfa/confirm", json={"code": wrong_code(setup["secret"], _now())}, headers=h
    )
    assert bad.status_code == 400 and bad.get_json()["error"]["code"] == "INVALID_CODE"

    res = client.post(
        f"{ME}/mfa/confirm", json={"code": code_at(setup["secret"], _now())}, headers=h
    )
    assert res.status_code == 200
    assert res.get_json()["mfaEnabled"] is True and res.get_json()["mfaMethod"] == "TOTP"

    again = client.post(f"{ME}/mfa", json={"method": "TOTP"}, headers=h)
    assert again.status_code == 409 and again.get_json()["error"]["code"] == "MFA_ALREADY_ENABLED"

    res = client.post(
        f"{ME}/mfa/disable", json={"code": code_at(setup["secret"], _now(), 1)}, headers=h
    )
    assert res.status_code == 204
    assert client.get(ME, headers=h).get_json()["mfaEnabled"] is False


def test_a_wrong_code_here_never_logs_the_user_out(app, client):
    """Wrong code in a live session is 400, not 401 — a 401 means 'your token is bad'."""
    user = make_user()
    secret = enable_totp(user, _now())
    token, _ = issue_token(user)
    res = client.post(
        f"{ME}/mfa/disable", json={"code": wrong_code(secret, _now())}, headers=_bearer(token)
    )
    assert res.status_code == 400
    assert client.get(ME, headers=_bearer(token)).status_code == 200


def test_state_errors_and_bad_bodies(app, client):
    user = make_user()
    h = _bearer(issue_token(user)[0])
    r = client.post(f"{ME}/mfa/confirm", json={"code": "123456"}, headers=h)
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "NO_PENDING_SETUP"
    r = client.post(f"{ME}/mfa/disable", json={"code": "123456"}, headers=h)
    assert r.status_code == 409 and r.get_json()["error"]["code"] == "MFA_NOT_ENABLED"
    assert client.post(f"{ME}/mfa", json={"method": "SMS"}, headers=h).status_code == 400
    assert client.post(f"{ME}/mfa", json={}, headers=h).status_code == 400
    assert client.post(f"{ME}/mfa/confirm", json={"code": "12"}, headers=h).status_code == 400
    for path in ("mfa", "mfa/confirm", "mfa/disable"):
        assert client.post(f"{ME}/{path}", json={}).status_code == 401  # needs a session


def test_503_when_unconfigured_and_nothing_else_is_affected(app, client):
    user = make_user()
    other = make_user(email="other@example.com")
    h = _bearer(issue_token(user)[0])
    app.config["MFA_ENCRYPTION_KEY"] = ""

    res = client.post(f"{ME}/mfa", json={"method": "TOTP"}, headers=h)
    assert res.status_code == 503
    assert res.get_json()["error"]["code"] == "MFA_NOT_CONFIGURED"

    # Existing behaviour is untouched.
    assert client.get(ME, headers=h).status_code == 200
    assert _login(client, other.email).status_code == 200


# --- Admin reset -------------------------------------------------------------


def test_admin_reset_is_admin_only_and_clears_the_second_step(app, client):
    admin = make_user(email="root@example.com", role=UserRole.ADMIN)
    citizen = make_user(email="c@example.com")
    enable_totp(citizen, _now())
    url = f"{API_PREFIX}/admin/users/{citizen.id}/mfa-reset"

    assert client.post(url).status_code == 401
    assert client.post(url, headers=_bearer(issue_token(citizen)[0])).status_code == 403

    admin_h = _bearer(issue_token(admin)[0])
    assert client.post(url, headers=admin_h).status_code == 204
    assert client.post(url, headers=admin_h).status_code == 204  # idempotent
    assert (
        client.post(f"{API_PREFIX}/admin/users/99999/mfa-reset", headers=admin_h).status_code == 404
    )

    assert _login(client, citizen.email).status_code == 200  # back to a plain login
    listed = client.get(f"{API_PREFIX}/admin/users", headers=admin_h).get_json()["data"]
    assert all(u["mfaEnabled"] is False for u in listed if u["email"] == citizen.email)


# --- Privacy walls -----------------------------------------------------------

FORBIDDEN_KEYS = {
    "mfa_secret_enc",
    "mfaSecretEnc",
    "google_sub",
    "googleSub",
    "totp",
    "password_hash",
}


def _keys(payload):
    if isinstance(payload, dict):
        for key, value in payload.items():
            yield key
            yield from _keys(value)
    elif isinstance(payload, list):
        for item in payload:
            yield from _keys(item)


def test_no_secret_or_google_id_appears_in_any_user_response(app, client):
    admin = make_user(email="root@example.com", role=UserRole.ADMIN)
    user = make_user()
    secret = enable_totp(user, _now())
    admin_h = _bearer(issue_token(admin)[0])
    user_h = _bearer(issue_token(user)[0])

    responses = [
        client.get(ME, headers=user_h),
        client.get(f"{API_PREFIX}/admin/users", headers=admin_h),
        client.get(f"{API_PREFIX}/admin/users/{user.id}", headers=admin_h),
        _login(client),  # the 202
    ]
    for res in responses:
        payload = res.get_json()
        assert not FORBIDDEN_KEYS & set(_keys(payload)), res.request.path
        assert secret not in res.get_data(as_text=True), res.request.path
