"""Self-service profile actions, for any authenticated role."""

from __future__ import annotations

from flask import Blueprint

from app.api.account.schemas import ChangePasswordRequest, UpdateProfileRequest
from app.api.shared.serializers import serialize_user
from app.core.auth import require_auth
from app.core.validation import validate_body

bp = Blueprint("account", __name__)


@bp.get("/users/me")
@require_auth
def get_my_profile():
    """200 User — the caller's own account."""
    from app.core.auth import current_user

    return serialize_user(current_user())


@bp.patch("/users/me")
@require_auth
@validate_body(UpdateProfileRequest)
def update_my_profile(body: UpdateProfileRequest):
    """200 User.

    The contract allows updating name, displayName, email, and zoneId.
    zoneId is CITIZEN-only — an OFFICER or ADMIN sending it gets 403.
    email uniqueness violations produce 409.
    """
    from app.core.auth import current_user
    from app.domain.enums import UserRole
    from app.domain.errors import ForbiddenError
    from app.services.accounts import users

    user = current_user()

    # 403: non-citizen cannot change their own zone.
    if body.zoneId is not None and user.role != UserRole.CITIZEN:
        raise ForbiddenError(
            "Only citizens can change their own zone. "
            "Officer zone assignment is managed by an admin."
        )

    updated_user = users.update_own_profile(
        user=user,
        full_name=body.name,
        display_name=body.displayName,
        email=body.email,
        zone_id=body.zoneId,
    )
    return serialize_user(updated_user)


@bp.post("/users/me/change-password")
@require_auth
@validate_body(ChangePasswordRequest)
def change_my_password(body: ChangePasswordRequest):
    """204."""
    from app.core.auth import current_user
    from app.services.accounts import auth

    auth.change_password(
        user=current_user(),
        current_password=body.currentPassword,
        new_password=body.newPassword,
    )
    return "", 204
