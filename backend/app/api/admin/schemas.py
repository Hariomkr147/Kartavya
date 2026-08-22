"""Pydantic request and query models for admin endpoints."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.domain.enums import ComplaintStatus, DisputeVerdict, SlaLabel, UserRole


class AdminModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreatableRole(StrEnum):
    CITIZEN = "CITIZEN"
    OFFICER = "OFFICER"


class ComplaintQuery(AdminModel):
    zoneId: int | None = Field(default=None, gt=0)
    categoryId: int | None = Field(default=None, gt=0)
    status: list[ComplaintStatus] | ComplaintStatus | None = None
    slaLabel: SlaLabel | None = None
    dateFrom: datetime | None = None
    dateTo: datetime | None = None
    sort: str | None = None
    page: int = Field(default=1, ge=1)
    pageSize: int = Field(default=20, ge=1, le=100)


class ExportComplaintsQuery(AdminModel):
    zoneId: int | None = Field(default=None, gt=0)
    categoryId: int | None = Field(default=None, gt=0)
    status: list[ComplaintStatus] | ComplaintStatus | None = None
    slaLabel: SlaLabel | None = None
    dateFrom: datetime | None = None
    dateTo: datetime | None = None


class ComplaintOverrideRequest(AdminModel):
    status: ComplaintStatus | None = None
    categoryId: int | None = Field(default=None, gt=0)
    zoneId: int | None = Field(default=None, gt=0)
    reason: str | None = None

    @model_validator(mode="after")
    def has_something_to_record(self):
        """`reason` alone is enough.

        The contract lists it as an independently sendable field, and an admin
        annotating a complaint without altering it is a legitimate act — it
        lands in `status_history` with the admin as actor, which is exactly
        where the override description says every override is recorded. Only a
        genuinely empty body is a 400.
        """
        if (
            self.status is None
            and self.categoryId is None
            and self.zoneId is None
            and not (self.reason or "").strip()
        ):
            raise ValueError(
                "Send at least one of status, categoryId, zoneId, or a reason to record."
            )
        return self


class DisputeReviewRequest(AdminModel):
    verdict: DisputeVerdict
    reason: str = Field(min_length=1)

    @field_validator("reason")
    @classmethod
    def nonblank_reason(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("reason must not be blank")
        return value


class UserQuery(AdminModel):
    role: UserRole | None = None
    zoneId: int | None = Field(default=None, gt=0)
    active: bool | None = None
    page: int = Field(default=1, ge=1)
    pageSize: int = Field(default=20, ge=1, le=100)


class CreateUserRequest(AdminModel):
    role: CreatableRole
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8)
    zoneId: int | None = Field(default=None, gt=0)

    @field_validator("name")
    @classmethod
    def nonblank_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("name must not be blank")
        return value

    @model_validator(mode="after")
    def officer_requires_zone(self):
        if self.role is CreatableRole.OFFICER and self.zoneId is None:
            raise ValueError("An OFFICER requires exactly one zoneId.")
        return self


class UpdateUserRequest(AdminModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    email: EmailStr | None = None
    zoneId: int | None = Field(default=None, gt=0)
    active: bool | None = None

    @field_validator("name")
    @classmethod
    def nonblank_name(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("name must not be blank")
        return value


class AdminResetPasswordRequest(AdminModel):
    """Admin-initiated reset. No `currentPassword` — see the contract note."""

    newPassword: str = Field(min_length=8)


class AssignOfficerRequest(AdminModel):
    officerId: int = Field(gt=0)


class CreateZoneRequest(AdminModel):
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=120)
    centerLat: float = Field(ge=-90, le=90)
    centerLng: float = Field(ge=-180, le=180)

    @field_validator("code", "name")
    @classmethod
    def nonblank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be blank")
        return value


class UpdateZoneRequest(AdminModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    isActive: bool | None = None

    @field_validator("name")
    @classmethod
    def nonblank_name(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("name must not be blank")
        return value


class SlaUpdateRequest(AdminModel):
    targetHours: int = Field(ge=1)


class SettingsRequest(AdminModel):
    autoCloseTimeoutHours: int = Field(ge=1)


class PerformancePeriod(StrEnum):
    THIS_MONTH = "this_month"
    LAST_MONTH = "last_month"
    ALL_TIME = "all_time"


class OfficerPerformanceQuery(AdminModel):
    period: PerformancePeriod = PerformancePeriod.THIS_MONTH
    dateFrom: datetime | None = None
    dateTo: datetime | None = None
