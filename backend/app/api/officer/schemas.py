"""Request models for the officer endpoints.

Use `model_config = ConfigDict(extra="forbid")` on each.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.domain.enums import (
    ComplaintStatus,
    EvidenceVerdict,
    OfficerTargetStatus,
    SeverityLabel,
    SlaLabel,
)


class OfficerQueueQuery(BaseModel):
    """openapi.yaml: GET /officer/complaints parameters.

    `status` is repeatable, so it accepts either shape — `core.validation`
    unwraps a single value and leaves a list alone.
    """

    model_config = ConfigDict(extra="forbid")

    status: list[ComplaintStatus] | ComplaintStatus | None = None
    categoryId: int | None = Field(default=None, gt=0)
    slaLabel: SlaLabel | None = None
    severityLabel: SeverityLabel | None = None
    sort: str | None = None
    page: int | None = Field(default=1, ge=1)
    pageSize: int | None = Field(default=20, ge=1, le=100)


class EvidenceReviewRequest(BaseModel):
    verdict: EvidenceVerdict
    reason: str | None = None

    model_config = ConfigDict(extra="forbid")


class StatusUpdateRequest(BaseModel):
    status: OfficerTargetStatus
    reason: str | None = None
    note: str | None = None

    model_config = ConfigDict(extra="forbid")


class ProgressNoteRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)

    model_config = ConfigDict(extra="forbid")

    @field_validator("text")
    @classmethod
    def trim_non_blank_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Note text must not be blank.")
        return value


def _database_id(value: str) -> str:
    if int(value) > 2**63 - 1:
        raise ValueError("ID is outside the supported database range.")
    return value


PositiveId = Annotated[
    str,
    Field(pattern=r"^[1-9][0-9]*$"),
    AfterValidator(_database_id),
]


class BatchStatusUpdateRequest(BaseModel):
    complaintIds: list[PositiveId] | None = Field(default=None, min_length=1, max_length=100)
    clusterId: PositiveId | None = None
    status: OfficerTargetStatus
    reason: str | None = None
    note: str | None = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def exactly_one_selector(cls, value: Any):
        if not isinstance(value, dict):
            return value
        has_complaint_ids = "complaintIds" in value
        has_cluster_id = "clusterId" in value
        if has_complaint_ids == has_cluster_id:
            raise ValueError("Exactly one of complaintIds or clusterId must be supplied.")
        selected = value.get("complaintIds") if has_complaint_ids else value.get("clusterId")
        if selected is None:
            raise ValueError("The selected complaintIds or clusterId must not be null.")
        return value


class OfficerAnalyticsQuery(BaseModel):
    dateFrom: datetime | None = None
    dateTo: datetime | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("dateFrom", "dateTo", mode="before")
    @classmethod
    def require_iso_datetime(cls, value: Any):
        if value is None:
            return value
        if not isinstance(value, str) or "t" not in value.lower():
            raise ValueError("Date filters must be ISO-8601 date-time strings.")
        normalized = value[:-1] + "+00:00" if value.lower().endswith("z") else value
        try:
            datetime.fromisoformat(normalized)
        except ValueError as exc:
            raise ValueError("Date filters must be ISO-8601 date-time strings.") from exc
        return value

    @model_validator(mode="after")
    def ordered_range(self):
        date_from = self.dateFrom
        date_to = self.dateTo
        if date_from is not None and date_from.tzinfo is not None:
            date_from = date_from.astimezone(UTC).replace(tzinfo=None)
        if date_to is not None and date_to.tzinfo is not None:
            date_to = date_to.astimezone(UTC).replace(tzinfo=None)
        if (
            date_from is not None
            and date_to is not None
            and date_from > date_to
        ):
            raise ValueError("dateFrom must be on or before dateTo.")
        return self
