"""Request models for /users/me*.

Mirrored from openapi.yaml UpdateProfileRequest and ChangePasswordRequest.
`extra="forbid"` so an unexpected key is a clean 400 rather than being silently
dropped.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr, Field


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
