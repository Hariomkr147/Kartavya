"""Citizen request validation schemas."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class FeedQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    zoneId: int | None = Field(default=None, gt=0)
    includeResolved: bool = Field(default=False)
    categoryId: int | None = Field(default=None, gt=0)
    sort: str | None = Field(default="-createdAt")
    page: int | None = Field(default=1, ge=1)
    pageSize: int | None = Field(default=20, ge=1, le=100)


class LeaderboardQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: str = Field(..., pattern="^(zone|city)$")
    period: str = Field(default="monthly", pattern="^(monthly|all_time)$")
    page: int | None = Field(default=1, ge=1)
    pageSize: int | None = Field(default=20, ge=1, le=100)
