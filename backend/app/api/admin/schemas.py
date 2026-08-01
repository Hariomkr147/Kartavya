"""Admin request validation schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.domain.enums import ComplaintStatus, SlaLabel


class ExportComplaintsQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    startDate: datetime | None = Field(default=None)
    endDate: datetime | None = Field(default=None)
    status: list[ComplaintStatus] | ComplaintStatus | None = Field(default=None)
    slaLabel: SlaLabel | None = Field(default=None)
    zoneId: int | None = Field(default=None, gt=0)
    categoryId: int | None = Field(default=None, gt=0)
