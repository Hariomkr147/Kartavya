"""Officer deltas — queue ordering and the cascade array, and nothing else.

⚠ There is NO reporter field in this file and there never will be. If a ticket
asks for "just the reporter's initials so officers can follow up", the answer is
no: officers reach citizens through the progress-note channel, which is exactly
why that channel exists.
"""

from __future__ import annotations

from typing import Any

from app.api.shared.serializers import SerializationContext
from app.models import Complaint


from app.api.shared.serializers import (
    SerializationContext,
    serialize_complaint,
    serialize_complaint_detail,
)
from app.models import Complaint


def serialize_queue_item(complaint: Complaint, ctx: SerializationContext) -> dict[str, Any]:
    """One row of the officer queue."""
    return serialize_complaint(complaint, ctx)


def serialize_status_update_result(
    complaint: Complaint, cascade: list[dict[str, Any]], ctx: SerializationContext
) -> dict[str, Any]:
    """`StatusUpdateResult` {complaint, cascade?}."""
    res = {
        "complaint": serialize_complaint_detail(complaint, ctx)
    }
    # Cascade is present ONLY when this update set a clustered complaint to RESOLVED
    if complaint.status.value == "RESOLVED" and complaint.cluster_id is not None:
        res["cascade"] = cascade
    return res


def serialize_batch_result(
    updated: list[Complaint], failures: list[dict[str, Any]], ctx: SerializationContext
) -> dict[str, Any]:
    """`BatchStatusUpdateResult`."""
    return {
        "updated": [serialize_complaint_detail(c, ctx) for c in updated],
        "failures": failures,
    }

