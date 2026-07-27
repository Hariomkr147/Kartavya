"""Self-service profile actions, for any authenticated role."""

from __future__ import annotations

from flask import Blueprint

from app.api.shared.responses import todo
from app.core.auth import require_auth

bp = Blueprint("account", __name__)


@bp.get("/users/me")
@require_auth
def get_my_profile():
    """200 User — the caller's own account.

    TODO(phase 2). This and the admin views are the ONLY places `full_name` is
    ever emitted. Everywhere else uses `display_name` with a masked fallback.
    """
    todo("Own profile")


@bp.patch("/users/me")
@require_auth
def update_my_profile():
    """200 User.

    TODO(phase 2). A citizen may change their `display_name` — the only handle
    other citizens see.
    """
    todo("Profile update")


@bp.post("/users/me/change-password")
@require_auth
def change_my_password():
    """204.

    TODO(phase 2). Verify the CURRENT password first, even though the caller is
    already authenticated.
    """
    todo("Password change")
