"""Request models for /auth/*.

Mirrored by hand from `components/schemas` in backend/api/openapi.yaml. Keep the
field names in camelCase to match the contract exactly — the wire format is the
contract's, not Python's.

These two are written out in full as the worked example for the other packages;
the rest are listed as TODOs in their own `schemas.py`.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    """openapi.yaml: RegisterRequest.

    `extra="forbid"` so an unexpected key is a clean 400 rather than being
    silently dropped — which is how a client-side typo like `zoneID` turns into
    a confusing "field required" instead of a mystery.
    """

    model_config = ConfigDict(extra="forbid")

    #: The contract calls this `name`; it lands in `users.full_name`.
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8)
    #: A string on the wire — every API id is the numeric row id stringified.
    #: The prefixed examples in openapi.yaml ("zone_012") are illustrative, not
    #: a pattern the contract enforces; see frontend/src/mocks/lib/ids.ts.
    zoneId: str


class LoginRequest(BaseModel):
    """openapi.yaml: LoginRequest."""

    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str
