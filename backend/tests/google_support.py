"""Builds Google-style ID tokens, signed locally, so the REAL verifier runs in tests.

`app.core.google._signing_key` is the one seam swapped out: instead of fetching
Google's public keys over the network it hands back the public half of a key
generated here. Everything else — signature, `aud`, `iss`, `exp`, `email_verified`
— is the production code path. No test ever talks to Google.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from functools import lru_cache

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

CLIENT_ID = "test-client.apps.googleusercontent.com"
ISSUER = "https://accounts.google.com"


@lru_cache(maxsize=1)
def _keypair():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@lru_cache(maxsize=1)
def _other_keypair():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def public_key():
    return _keypair().public_key()


def id_token(
    *,
    sub: str = "google-sub-1",
    email: str = "asha@example.com",
    name: str | None = "Asha Verma",
    aud: str = CLIENT_ID,
    iss: str = ISSUER,
    email_verified: bool | str = True,
    expires_in: timedelta = timedelta(hours=1),
    signed_by_google: bool = True,
    drop: tuple[str, ...] = (),
) -> str:
    now = datetime.now(UTC)
    claims = {
        "iss": iss,
        "aud": aud,
        "sub": sub,
        "email": email,
        "email_verified": email_verified,
        "name": name,
        "iat": int((now - timedelta(seconds=5)).timestamp()),
        "exp": int((now + expires_in).timestamp()),
    }
    for key in drop:
        claims.pop(key, None)
    key = _keypair() if signed_by_google else _other_keypair()
    return jwt.encode(claims, key, algorithm="RS256")


def install(app, monkeypatch) -> None:
    """Turn Google on for `app` and route key lookup to the local keypair."""
    app.config["GOOGLE_CLIENT_ID"] = CLIENT_ID
    monkeypatch.setattr("app.core.google._signing_key", lambda token: public_key())
