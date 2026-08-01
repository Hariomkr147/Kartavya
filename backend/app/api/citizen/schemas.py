"""Request models for the citizen package."""

from __future__ import annotations

import math

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.domain.enums import ComplaintStatus


class CreateComplaintForm(BaseModel):
    model_config = ConfigDict(extra="forbid")

    categoryId: int = Field(..., gt=0)
    zoneId: int = Field(..., gt=0)
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    description: str | None = Field(default=None)
    categorySuggestedByMatcher: bool = Field(default=False)

    @field_validator("latitude", "longitude")
    @classmethod
    def check_finite(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("Coordinate must be a finite number.")
        return value


class ComplaintListQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page: int | None = Field(default=1, ge=1)
    pageSize: int | None = Field(default=20, ge=1, le=100)
    sort: str | None = Field(default="-createdAt")
    status: list[ComplaintStatus] | ComplaintStatus | None = Field(default=None)
    categoryId: int | None = Field(default=None, gt=0)
