"""app/core/google.py — every claim the verifier depends on."""

from datetime import timedelta

import jwt
import pytest

from app.core import google
from app.domain.errors import AuthError, ServiceUnavailableError
from tests import google_support as gs


@pytest.fixture(autouse=True)
def _google_on(app, monkeypatch):
    gs.install(app, monkeypatch)


def test_a_good_token_yields_the_identity(app):
    identity = google.verify_google_id_token(gs.id_token(email="Asha@Example.com "))
    assert identity.sub == "google-sub-1"
    assert identity.email == "asha@example.com"  # normalised, like every email here
    assert identity.name == "Asha Verma"


def test_accepts_both_issuer_spellings_google_uses(app):
    for iss in ("accounts.google.com", "https://accounts.google.com"):
        assert google.verify_google_id_token(gs.id_token(iss=iss))


@pytest.mark.parametrize(
    "kwargs",
    [
        {"aud": "some-other-app.apps.googleusercontent.com"},
        {"iss": "https://evil.example.com"},
        {"expires_in": timedelta(minutes=-5)},
        {"signed_by_google": False},
        {"email_verified": False},
        {"email_verified": "false"},
        {"drop": ("email_verified",)},
        {"drop": ("email",)},
        {"drop": ("sub",)},
        {"drop": ("exp",)},
        {"drop": ("aud",)},
    ],
)
def test_every_bad_token_is_a_401(app, kwargs):
    with pytest.raises(AuthError):
        google.verify_google_id_token(gs.id_token(**kwargs))


def test_a_few_seconds_of_clock_skew_is_tolerated(app):
    assert google.verify_google_id_token(gs.id_token(expires_in=timedelta(seconds=-3)))


def test_garbage_and_alg_none_are_refused(app):
    with pytest.raises(AuthError):
        google.verify_google_id_token("not-a-jwt")
    unsigned = jwt.encode(
        {"sub": "x", "email": "a@b.c", "aud": gs.CLIENT_ID}, None, algorithm="none"
    )
    with pytest.raises(AuthError):
        google.verify_google_id_token(unsigned)
    # An HS256 token "signed" with the public key as a secret must not verify either.
    hs = jwt.encode({"sub": "x"}, "secret", algorithm="HS256")
    with pytest.raises(AuthError):
        google.verify_google_id_token(hs)


def test_unset_client_id_is_503_not_a_crash(app):
    app.config["GOOGLE_CLIENT_ID"] = ""
    with pytest.raises(ServiceUnavailableError) as exc:
        google.verify_google_id_token(gs.id_token())
    assert exc.value.code == "GOOGLE_NOT_CONFIGURED"


def test_unreachable_google_is_503_not_401(app, monkeypatch):
    def down(token):
        raise jwt.PyJWKClientConnectionError("network unreachable")

    monkeypatch.setattr("app.core.google._signing_key", down)
    with pytest.raises(ServiceUnavailableError) as exc:
        google.verify_google_id_token(gs.id_token())
    assert exc.value.code == "GOOGLE_UNAVAILABLE"
