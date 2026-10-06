"""Verifies a Google ID token — the proof behind "Sign in with Google".

The browser gets a Google-signed JWT from Google Identity Services and sends it
here. Nothing the client says about who it is can be trusted; only the token can,
and only after every one of these holds:

- the signature checks out against Google's published keys (RS256, keys fetched
  and cached by `PyJWKClient` from `GOOGLE_JWKS_URL`),
- `aud` is OUR client id — a token minted for some other app is refused,
- `iss` is Google,
- `exp` has not passed (10 seconds of clock leeway),
- `email_verified` is true — an unverified address proves nothing.

With `GOOGLE_CLIENT_ID` unset the feature is off: a 503 that names the setting,
and nothing else in the API is affected.
"""

from __future__ import annotations

from dataclasses import dataclass

import jwt
from flask import current_app

from app.domain.errors import AuthError, ServiceUnavailableError

GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
_ISSUERS = ("accounts.google.com", "https://accounts.google.com")
_LEEWAY_SECONDS = 10

_jwk_client: jwt.PyJWKClient | None = None


@dataclass(frozen=True)
class GoogleIdentity:
    """What a verified token proves. `sub` is Google's stable account id."""

    sub: str
    email: str
    name: str | None


def is_configured() -> bool:
    return bool(current_app.config.get("GOOGLE_CLIENT_ID"))


def _signing_key(token: str):
    """The public key Google signed `token` with. Its own function so tests can swap it."""
    global _jwk_client
    if _jwk_client is None:
        _jwk_client = jwt.PyJWKClient(GOOGLE_JWKS_URL, cache_keys=True, timeout=5)
    return _jwk_client.get_signing_key_from_jwt(token).key


def verify_google_id_token(token: str) -> GoogleIdentity:
    client_id = current_app.config.get("GOOGLE_CLIENT_ID")
    if not client_id:
        raise ServiceUnavailableError(
            "Google sign-in is not set up on this server.", code="GOOGLE_NOT_CONFIGURED"
        )

    try:
        claims = jwt.decode(
            token,
            _signing_key(token),
            algorithms=["RS256"],  # pinned: never let the token choose its own algorithm
            audience=client_id,
            leeway=_LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except jwt.PyJWKClientConnectionError as exc:
        # Could not reach Google's key endpoint: not the user's fault, so not a 401.
        raise ServiceUnavailableError(
            "Could not reach Google to check your sign-in. Please try again.",
            code="GOOGLE_UNAVAILABLE",
        ) from exc
    except jwt.PyJWTError as exc:
        raise AuthError("Google sign-in failed. Please try again.") from exc

    if claims.get("iss") not in _ISSUERS:
        raise AuthError("Google sign-in failed. Please try again.")
    if claims.get("email_verified") not in (True, "true"):
        raise AuthError("Your Google email address is not verified.")
    email = str(claims.get("email") or "").strip().lower()
    sub = str(claims.get("sub") or "")
    if not email or not sub:
        raise AuthError("Google sign-in failed. Please try again.")
    name = claims.get("name")
    return GoogleIdentity(sub=sub, email=email, name=str(name).strip() if name else None)
