"""Self-service profile actions, for any authenticated role."""

from __future__ import annotations

from flask import Blueprint

from app.api.account.schemas import (
    ChangePasswordRequest,
    LinkGoogleRequest,
    MfaCodeRequest,
    MfaSetupRequest,
    UpdateProfileRequest,
    serialize_user,
)
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


@bp.post("/users/me/mfa")
@require_auth
@validate_body(MfaSetupRequest)
def start_mfa_setup(body: MfaSetupRequest):
    """201 MfaSetupResponse. The secret is in this response and nowhere else, ever."""
    from datetime import UTC, datetime

    from app.core.auth import current_user
    from app.services.accounts.mfa import service as mfa

    prompt = mfa.start_setup(current_user(), body.method, datetime.now(UTC))
    return {
        "method": prompt.method.value,
        "otpauthUri": prompt.otpauth_uri,
        "secret": prompt.secret,
    }, 201


@bp.post("/users/me/mfa/confirm")
@require_auth
@validate_body(MfaCodeRequest)
def confirm_mfa_setup(body: MfaCodeRequest):
    """200 User — two-step verification is now on."""
    from datetime import UTC, datetime

    from app.core.auth import current_user
    from app.services.accounts.mfa import service as mfa

    return serialize_user(mfa.confirm_setup(current_user(), body.code, datetime.now(UTC)))


@bp.post("/users/me/mfa/disable")
@require_auth
@validate_body(MfaCodeRequest)
def disable_mfa(body: MfaCodeRequest):
    """204. Needs a current code, so a stolen session alone cannot remove the second step."""
    from datetime import UTC, datetime

    from app.core.auth import current_user
    from app.services.accounts.mfa import service as mfa

    mfa.disable(current_user(), body.code, datetime.now(UTC))
    return "", 204


@bp.post("/users/me/google")
@require_auth
@validate_body(LinkGoogleRequest)
def link_google_account(body: LinkGoogleRequest):
    """200 User. Any role — the only way an officer or admin starts using Google."""
    from app.core import google
    from app.core.auth import current_user
    from app.services.accounts import auth

    identity = google.verify_google_id_token(body.idToken)
    return serialize_user(auth.link_google(current_user(), identity))


@bp.delete("/users/me/google")
@require_auth
def unlink_google_account():
    """204. Refused unless the account has a password of its own."""
    from app.core.auth import current_user
    from app.services.accounts import auth

    auth.unlink_google(current_user())
    return "", 204
