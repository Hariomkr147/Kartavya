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


def serialize_queue_item(complaint: Complaint, ctx: SerializationContext) -> dict[str, Any]:
    """One row of the officer queue. TODO(phase 4).

    The compact Complaint shape unchanged — severity and SLA labels derived,
    upvote count prefetched, photo URL freshly signed.
    """
    raise NotImplementedError


def serialize_status_update_result(
    complaint: Complaint, cascade: list[dict[str, Any]], ctx: SerializationContext
) -> dict[str, Any]:
    """`StatusUpdateResult` {complaint, cascade?}. TODO(phase 4).

    `cascade` is present ONLY when this update set a clustered complaint to
    RESOLVED — absent for standalone complaints and for every non-RESOLVED
    update. Each entry is {complaintId, outcome, previousStatus}.
    """
    raise NotImplementedError


def serialize_batch_result(
    updated: list[Complaint], failures: list[dict[str, Any]], ctx: SerializationContext
) -> dict[str, Any]:
    """`BatchStatusUpdateResult`. TODO(phase 5).

    Per-item failures live in the 200 body with a `TransitionFailureCode` — they
    are not errors at the HTTP level.
    """
    raise NotImplementedError
