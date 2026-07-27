"""Public: registration and login. The only two doors without a token.

Officers are created by admins (`POST /admin/users`), never here. Admins are
seeded directly into the database and have no creation endpoint at all.
"""

from __future__ import annotations

from flask import Blueprint

from app.api.auth.schemas import LoginRequest, RegisterRequest
from app.api.shared.responses import todo
from app.core.validation import validate_body

bp = Blueprint("auth", __name__)


@bp.post("/auth/register")
@validate_body(RegisterRequest)
def register_citizen(body: RegisterRequest):
    """201 AuthResponse. Public (`security: []`).

    TODO(phase 2): `services.accounts.auth.register_citizen(...)`, then
    `core.auth.issue_token`. Role is forced to CITIZEN whatever the body says.
    409 EMAIL_TAKEN if the address exists in any role.
    """
    todo("Citizen registration")


@bp.post("/auth/login")
@validate_body(LoginRequest)
def login_user(body: LoginRequest):
    """200 AuthResponse {token, expiresAt, user}. Public (`security: []`).

    TODO(phase 2): `services.accounts.auth.authenticate(...)`. One identical 401
    for a bad email, a bad password and a deactivated account — three different
    messages would turn this into an account-enumeration oracle.

    `expiresAt` mirrors the JWT's `exp` claim. There is no refresh endpoint.
    """
    todo("Login")
