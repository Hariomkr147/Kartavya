"""Request models for /users/me*.

Mirrored from openapi.yaml UpdateProfileRequest and ChangePasswordRequest.
`extra="forbid"` so an unexpected key is a clean 400 rather than being silently
dropped.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.serialization import iso_utc
from app.domain.credentials import has_usable_password
from app.domain.enums import MfaMethodType, MfaPolicy, UserRole
from app.domain.mfa_policy import mfa_policy
from app.models import User


class UpdateProfileRequest(BaseModel):
    """openapi.yaml: UpdateProfileRequest.

    All fields are optional — send only what changes.
    ``zoneId`` is CITIZEN-only; the route enforces the 403.
    ``email`` uniqueness (409) is enforced by the service.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    displayName: str | None = Field(default=None, min_length=1, max_length=60)
    email: EmailStr | None = Field(default=None)
    zoneId: str | None = Field(default=None)


class ChangePasswordRequest(BaseModel):
    """openapi.yaml: ChangePasswordRequest."""

    model_config = ConfigDict(extra="forbid")

    currentPassword: str
    newPassword: str = Field(min_length=8)


def security_fields(user: User) -> dict[str, Any]:
    """The derived sign-in flags on `User`. Nothing here is stored, and never
    included: mfa_secret_enc, google_sub."""
    return {
        "mfaEnabled": user.mfa_method is not None,
        "mfaMethod": user.mfa_method.value if user.mfa_method is not None else None,
        "mfaRecommended": user.mfa_method is None
        and mfa_policy(UserRole(user.role)) is MfaPolicy.RECOMMENDED,
        # `or ""`: password_hash is NOT NULL in the database, but tests build
        # transient User objects without one, and "no marker" means "has one".
        "hasPassword": has_usable_password(user.password_hash or ""),
        "googleLinked": user.google_sub is not None,
    }


def serialize_user(user: User) -> dict[str, Any]:
    """Canonical User → JSON dict  (openapi.yaml ``User``).

    Field-name mapping::

        model attr     →  JSON key
        ─────────────     ────────
        full_name      →  name       (NOT fullName)
        is_active      →  active     (NOT isActive)
        zone_id        →  zoneId

    ``zoneName`` is deliberately absent — it is not in the contract and would
    trigger an extra query per row.

    Timestamps include an explicit UTC offset so that JavaScript's
    ``new Date(...)`` never misinterprets them as local time.
    """
    return {
        "id": str(user.id),
        "role": (str(user.role.value) if hasattr(user.role, "value") else str(user.role)),
        "name": user.full_name,
        "email": user.email,
        "displayName": user.display_name,
        "zoneId": str(user.zone_id) if user.zone_id is not None else None,
        "active": user.is_active,
        "createdAt": iso_utc(user.created_at),
        **security_fields(user),
    }


class MfaSetupRequest(BaseModel):
    """openapi.yaml: MfaSetupRequest."""

    model_config = ConfigDict(extra="forbid")

    method: MfaMethodType


class MfaCodeRequest(BaseModel):
    """openapi.yaml: MfaCodeRequest."""

    model_config = ConfigDict(extra="forbid")

    code: str = Field(pattern=r"^[0-9]{6}$")


class LinkGoogleRequest(BaseModel):
    """openapi.yaml: LinkGoogleRequest."""

    model_config = ConfigDict(extra="forbid")

    idToken: str = Field(min_length=1)
