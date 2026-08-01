"""Request models for the officer endpoints.

Use `model_config = ConfigDict(extra="forbid")` on each.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, ConfigDict

from app.domain.enums import EvidenceVerdict, OfficerTargetStatus


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


class BatchStatusUpdateRequest(BaseModel):
    complaintIds: list[str] | None = None
    clusterId: str | None = None
    status: OfficerTargetStatus
    reason: str | None = None
    note: str | None = None
    
    model_config = ConfigDict(extra="forbid")
