"""Officer response shapes with reporter identity structurally absent."""

from __future__ import annotations

from typing import Any

from app.api.shared.serializers import (
    SerializationContext,
    serialize_complaint,
    serialize_complaint_detail,
)
from app.models import Complaint


def serialize_officer_complaint_detail(
    complaint: Complaint,
    ctx: SerializationContext,
    evidence_list: list[Any] | None = None,
    history_list: list[Any] | None = None,
    notes_list: list[Any] | None = None,
) -> dict[str, Any]:
    """Return ComplaintDetail without any reporter identity."""
    return serialize_complaint_detail(
        complaint,
        ctx,
        evidence_list=evidence_list,
        history_list=history_list,
        notes_list=notes_list,
    )


def serialize_queue_item(complaint: Complaint, ctx: SerializationContext) -> dict[str, Any]:
    """Return one compact row of the officer queue."""
    return serialize_complaint(complaint, ctx)


def serialize_status_update_result(
    complaint: Complaint, cascade: list[dict[str, Any]], ctx: SerializationContext
) -> dict[str, Any]:
    """Return a status update and an optional clustered-resolution cascade.

    `cascade` is ABSENT — not null — for standalone complaints and for every
    non-RESOLVED update, which is what the contract's optional field means.
    """
    result: dict[str, Any] = {"complaint": serialize_complaint_detail(complaint, ctx)}
    if complaint.status.value == "RESOLVED" and complaint.cluster_id is not None:
        result["cascade"] = cascade
    return result
