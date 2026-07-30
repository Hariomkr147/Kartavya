"""Citizen deltas on top of the neutral shapes.

A citizen sees their own complaint in full — but never another citizen's
identity, and never an officer's name.
"""

from __future__ import annotations

from typing import Any

from app.api.shared.serializers import (
    SerializationContext,
    serialize_complaint,
    serialize_complaint_detail,
)
from app.domain.enums import ComplaintStatus
from app.models import Complaint


def serialize_own_complaint(complaint: Complaint, ctx: SerializationContext) -> dict[str, Any]:
    """The shared ComplaintDetail plus `citizenActionNeeded`.

    `citizenActionNeeded` is CONFIRM_FIX when the complaint is RESOLVED and
    PROVIDE_MORE_EVIDENCE when it is NEEDS_MORE_EVIDENCE — derived from status,
    never stored, and emitted only to the owner.
    """
    payload = serialize_complaint_detail(complaint, ctx)
    action = None
    if complaint.status is ComplaintStatus.RESOLVED:
        action = "CONFIRM_FIX"
    elif complaint.status is ComplaintStatus.NEEDS_MORE_EVIDENCE:
        action = "PROVIDE_MORE_EVIDENCE"
    payload["citizenActionNeeded"] = action
    return payload


def serialize_feed_item(complaint: Complaint, ctx: SerializationContext) -> dict[str, Any]:
    """`FeedItem` — anonymized. TODO(phase 3).

    Reuses the compact shape, which structurally has no reporter field. Location
    IS included (the client shows a nearby-landmark hint from it); identity
    never is.
    """
    return serialize_complaint(complaint, ctx)


def serialize_leaderboard_entry(row: Any) -> dict[str, Any]:
    """`LeaderboardEntry`. TODO(phase 6).

    The handle is `display_name` or a server-generated masked fallback
    ("Citizen #1042"). Never `full_name`, under any circumstance.
    """
    raise NotImplementedError
