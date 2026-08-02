"""Self-service profile actions, for any authenticated role."""

from __future__ import annotations

from flask import Blueprint

from app.api.account.schemas import ChangePasswordRequest, UpdateProfileRequest
from app.api.account.schemas import serialize_user
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
    Business rules (403 for non-citizen zoneId, 409 for duplicate email)
    are enforced by the service, not here.

    ``model_fields_set`` distinguishes "field not sent" from "field sent as
    null" — important for displayName, where null means *clear it*.
    """
    from app.core.auth import current_user
    from app.services.accounts import users
    from app.services.accounts.users import _UNSET

    user = current_user()
    sent = body.model_fields_set

    updated_user = users.update_own_profile(
        user=user,
        caller_role=user.role,
        full_name=body.name if "name" in sent else _UNSET,
        display_name=body.displayName if "displayName" in sent else _UNSET,
        email=body.email if "email" in sent else _UNSET,
        zone_id=body.zoneId if "zoneId" in sent else _UNSET,
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
