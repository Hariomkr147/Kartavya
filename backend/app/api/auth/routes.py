"""Public: registration and login. The only two doors without a token.

Officers are created by admins (``POST /admin/users``), never here. Admins are
seeded directly into the database and have no creation endpoint at all.
"""

from __future__ import annotations

from flask import Blueprint

from app.api.auth.schemas import LoginRequest, RegisterRequest
from app.api.shared.responses import todo  # noqa: F401 — used by other stubs
from app.api.account.schemas import serialize_user
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


@bp.post("/auth/login")
@validate_body(LoginRequest)
def login_user(body: LoginRequest):
    """200 AuthResponse {token, tokenType, expiresAt, user}. Public (``security: []``)."""
    from app.core.auth import issue_token
    from app.services.accounts import auth

    user = auth.authenticate(email=body.email, password=body.password)
    token, expires_at = issue_token(user)

    return {
        "token": token,
        "tokenType": "Bearer",
        "expiresAt": expires_at.isoformat(),
        "user": serialize_user(user),
    }
