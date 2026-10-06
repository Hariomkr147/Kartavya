"""Two-step verification, end to end, through the same requests a browser sends.

Nothing is set up through the database: users register or are created by the
admin, and every code is computed from the secret the setup response returned —
which is exactly what an authenticator app does.
"""

from __future__ import annotations

from datetime import UTC, datetime

from tests.integration.conftest import API, PASSWORD
from tests.mfa_support import code_at, wrong_code


def _now():
    return datetime.now(UTC)


def _enrol(actor):
    """Turn 2FA on for a logged-in actor. Returns the secret."""
    setup = actor.post("/users/me/mfa", expect=201, json={"method": "TOTP"}).get_json()
    actor.post("/users/me/mfa/confirm", json={"code": code_at(setup["secret"], _now())})
    return setup["secret"]


def _login_with_code(platform, email, secret, *, offset=1):
    challenge = platform.client.post(
        f"{API}/auth/login", json={"email": email, "password": PASSWORD}
    )
    assert challenge.status_code == 202, challenge.get_json()
    ticket = challenge.get_json()["mfaTicket"]
    return platform.client.post(
        f"{API}/auth/mfa/verify",
        json={"mfaTicket": ticket, "code": code_at(secret, _now(), offset)},
    )


def test_a_citizen_turns_2fa_on_and_logs_in_with_a_code(platform):
    citizen = platform.register_citizen(email="asha@example.com")
    assert citizen.get("/users/me").get_json()["mfaEnabled"] is False

    secret = _enrol(citizen)
    assert citizen.get("/users/me").get_json()["mfaEnabled"] is True

    res = _login_with_code(platform, "asha@example.com", secret)
    assert res.status_code == 200
    token = res.get_json()["token"]
    me = platform.client.get(f"{API}/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200 and me.get_json()["mfaEnabled"] is True


def test_an_officer_is_nudged_but_can_log_in_without_2fa(platform):
    officer = platform.officer("north")
    me = officer.get("/users/me").get_json()
    assert me["role"] == "OFFICER"
    assert me["mfaEnabled"] is False and me["mfaRecommended"] is True
    # Recommended is not required: the plain login still returns a session.
    platform.login(officer.user["email"])


def test_an_officer_can_enable_2fa_too(platform):
    officer = platform.officer("north")
    secret = _enrol(officer)
    assert officer.get("/users/me").get_json()["mfaRecommended"] is False
    assert _login_with_code(platform, officer.user["email"], secret).status_code == 200


def test_the_admin_recovers_a_citizen_who_lost_their_device(platform):
    citizen = platform.register_citizen(email="lost@example.com")
    _enrol(citizen)
    platform.admin.post(f"/admin/users/{citizen.id}/mfa-reset", expect=204)
    platform.login("lost@example.com")  # a plain login works again
    assert citizen.get("/users/me").get_json()["mfaEnabled"] is False


def test_wrong_codes_lock_the_account_then_the_admin_can_clear_it(platform):
    citizen = platform.register_citizen(email="typo@example.com")
    secret = _enrol(citizen)
    challenge = platform.client.post(
        f"{API}/auth/login", json={"email": "typo@example.com", "password": PASSWORD}
    ).get_json()
    codes = [
        platform.client.post(
            f"{API}/auth/mfa/verify",
            json={"mfaTicket": challenge["mfaTicket"], "code": wrong_code(secret, _now())},
        ).status_code
        for _ in range(5)
    ]
    assert codes == [401, 401, 401, 401, 429]
    platform.admin.post(f"/admin/users/{citizen.id}/mfa-reset", expect=204)
    platform.login("typo@example.com")


def test_the_reporter_block_on_admin_complaints_did_not_grow(platform):
    """Two-step flags belong on admin *user* views, never on a complaint's reporter."""
    citizen = platform.register_citizen(email="reporter@example.com")
    _enrol(citizen)
    complaint = platform.file_complaint(citizen)
    detail = platform.admin.get(f"/complaints/{complaint['id']}").get_json()
    assert set(detail["reporter"]) == {
        "id", "role", "name", "email", "displayName", "zoneId", "active", "createdAt",
    }  # fmt: skip


# --- Google Sign-In, in the same journeys --------------------------------------


def _google_on(platform, monkeypatch):
    from tests import google_support

    google_support.install(platform.app, monkeypatch)
    return google_support


def test_a_new_citizen_signs_up_with_google_and_files_a_complaint(platform, monkeypatch):
    gs = _google_on(platform, monkeypatch)
    res = platform.client.post(
        f"{API}/auth/google",
        json={"idToken": gs.id_token(email="new@example.com"), "zoneId": platform.zone_id("north")},
    )
    assert res.status_code == 201
    body = res.get_json()
    from tests.integration.conftest import Actor

    citizen = Actor("google-citizen", platform.client, body["token"], body["user"])
    complaint = platform.file_complaint(citizen)  # a Google account is a full citizen
    assert citizen.status_of(complaint["id"]) == "SUBMITTED"


def test_staff_link_google_then_sign_in_and_2fa_still_applies(platform, monkeypatch):
    gs = _google_on(platform, monkeypatch)
    officer = platform.officer("north")
    email = officer.user["email"]

    refused = platform.client.post(
        f"{API}/auth/google", json={"idToken": gs.id_token(sub="g-officer", email=email)}
    )
    assert refused.status_code == 403  # an email match is never enough for staff

    officer.post("/users/me/google", json={"idToken": gs.id_token(sub="g-officer", email=email)})
    signed_in = platform.client.post(
        f"{API}/auth/google", json={"idToken": gs.id_token(sub="g-officer", email=email)}
    )
    assert signed_in.status_code == 200 and signed_in.get_json()["user"]["role"] == "OFFICER"

    secret = _enrol(officer)  # now turn 2FA on: Google must not bypass it
    challenged = platform.client.post(
        f"{API}/auth/google", json={"idToken": gs.id_token(sub="g-officer", email=email)}
    )
    assert challenged.status_code == 202
    done = platform.client.post(
        f"{API}/auth/mfa/verify",
        json={"mfaTicket": challenged.get_json()["mfaTicket"], "code": code_at(secret, _now(), 1)},
    )
    assert done.status_code == 200 and done.get_json()["user"]["role"] == "OFFICER"


def test_a_citizen_can_add_google_to_a_password_account_and_use_either(platform, monkeypatch):
    gs = _google_on(platform, monkeypatch)
    citizen = platform.register_citizen(email="both@example.com")
    citizen.post("/users/me/google", json={"idToken": gs.id_token(email="both@example.com")})
    assert citizen.get("/users/me").get_json()["googleLinked"] is True
    platform.login("both@example.com")  # the password still works
    assert (
        platform.client.post(
            f"{API}/auth/google", json={"idToken": gs.id_token(email="both@example.com")}
        ).status_code
        == 200
    )
    citizen.delete("/users/me/google")  # has a password, so unlinking is allowed
    assert citizen.get("/users/me").get_json()["googleLinked"] is False
