"""Public: registration and login. The only two doors without a token.

Officers are created by admins (``POST /admin/users``), never here. Admins are
seeded directly into the database and have no creation endpoint at all.
"""

from __future__ import annotations

from flask import Blueprint

from app.api.account.schemas import serialize_user
from app.api.auth.schemas import (
    GoogleSignInRequest,
    LoginRequest,
    MfaVerifyRequest,
    RegisterRequest,
)
from app.api.shared.responses import todo  # noqa: F401 — used by other stubs
from app.core.validation import validate_body

bp = Blueprint("auth", __name__)


@bp.post("/auth/register")
@validate_body(RegisterRequest)
def register_citizen(body: RegisterRequest):
    """201 AuthResponse. Public (``security: []``)."""
    from datetime import UTC, datetime

    from app.core.auth import issue_token
    from app.services.accounts import auth

    user = auth.register_citizen(
        full_name=body.name,
        email=body.email,
        password=body.password,
        zone_id=body.zoneId,
        display_name=None,
        now=datetime.now(UTC),
    )
    token, expires_at = issue_token(user)

    return {
        "token": token,
        "tokenType": "Bearer",
        "expiresAt": expires_at.isoformat(),
        "user": serialize_user(user),
    }, 201


def render_grant(grant, *, session_status: int = 200):
    """`AuthResponse` for a session, `202 MfaChallenge` for a half-finished login.

    Shared by every route that ends a first login step, so the two shapes are
    built in exactly one place.
    """
    from app.services.accounts.auth import MfaChallengeGrant

    if isinstance(grant, MfaChallengeGrant):
        return {
            "mfaRequired": True,
            "mfaTicket": grant.ticket,
            "method": grant.method.value,
            "expiresAt": grant.expires_at.isoformat(),
        }, 202
    return {
        "token": grant.token,
        "tokenType": "Bearer",
        "expiresAt": grant.expires_at.isoformat(),
        "user": serialize_user(grant.user),
    }, session_status


@bp.post("/auth/login")
@validate_body(LoginRequest)
def login_user(body: LoginRequest):
    """200 AuthResponse, or 202 MfaChallenge when the account has 2FA on. Public."""
    from datetime import UTC, datetime

    from app.services.accounts import auth

    user = auth.authenticate(email=body.email, password=body.password)
    return render_grant(auth.complete_primary_auth(user, datetime.now(UTC)))


@bp.post("/auth/mfa/verify")
@validate_body(MfaVerifyRequest)
def verify_mfa_login(body: MfaVerifyRequest):
    """200 AuthResponse. Public: the mfaTicket in the body is the credential."""
    from datetime import UTC, datetime

    from app.core.auth import decode_mfa_ticket
    from app.services.accounts import auth
    from app.services.accounts.mfa import service as mfa

    user_id = decode_mfa_ticket(body.mfaTicket)
    user = mfa.complete_login(user_id, body.code, datetime.now(UTC))
    return render_grant(auth.grant_session(user))


@bp.post("/auth/google")
@validate_body(GoogleSignInRequest)
def sign_in_with_google(body: GoogleSignInRequest):
    """200 / 201 AuthResponse, or 202 MfaChallenge. Public: the ID token is the credential."""
    from datetime import UTC, datetime

    from app.core import google
    from app.services.accounts import auth

    identity = google.verify_google_id_token(body.idToken)
    grant, created = auth.sign_in_with_google(
        identity=identity, zone_id=body.zoneId, now=datetime.now(UTC)
    )
    return render_grant(grant, session_status=201 if created else 200)
