"""Admin request validation schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.domain.enums import ComplaintStatus, SlaLabel


class ExportComplaintsQuery(BaseModel):
    """Query validation model for CSV export.

    NOTE (Phase 7 / OpenAPI Alignment):
    `status` accepts `list[ComplaintStatus] | ComplaintStatus | None` as an intentional
    superset of the OpenAPI query array definition, supporting both repeated parameters
    (`?status=SUBMITTED&status=IN_PROGRESS`) and single parameter strings (`?status=SUBMITTED`).
    """

    model_config = ConfigDict(extra="forbid")

    dateFrom: datetime | None = Field(default=None)
    dateTo: datetime | None = Field(default=None)
    status: list[ComplaintStatus] | ComplaintStatus | None = Field(default=None)
    slaLabel: SlaLabel | None = Field(default=None)
    zoneId: int | None = Field(default=None, gt=0)
    categoryId: int | None = Field(default=None, gt=0)
