"""Citizen deltas on top of the neutral shapes.

A citizen sees their own complaint in full — but never another citizen's
identity, and never an officer's name.
"""

from __future__ import annotations

from typing import Any

from app.core.context import SerializationContext
from app.domain.enums import ComplaintStatus
from app.models import Complaint


def serialize_own_complaint(
    complaint: Complaint,
    ctx: SerializationContext,
    is_detail: bool = False,
    evidence_list: list[Any] | None = None,
    history_list: list[Any] | None = None,
    notes_list: list[Any] | None = None,
) -> dict[str, Any]:
    """The shared Complaint or ComplaintDetail plus citizenActionNeeded."""
    if is_detail:
        from app.api.shared.serializers import serialize_complaint_detail

        data = serialize_complaint_detail(
            complaint,
            ctx,
            evidence_list=evidence_list,
            history_list=history_list,
            notes_list=notes_list,
        )
    else:
        from app.api.shared.serializers import serialize_complaint

        data = serialize_complaint(complaint, ctx)

    action_needed = None
    if complaint.status == ComplaintStatus.RESOLVED:
        action_needed = "CONFIRM_FIX"
    elif complaint.status == ComplaintStatus.NEEDS_MORE_EVIDENCE:
        action_needed = "PROVIDE_MORE_EVIDENCE"

    data["citizenActionNeeded"] = action_needed
    return data


def serialize_feed_item(
    complaint: Complaint,
    ctx: SerializationContext,
    citizen_upvoted_ids: set[int] | None = None,
) -> dict[str, Any]:
    """`FeedItem` — anonymized matching openapi.yaml schema.

    Required: [id, category, status, upvoteCount, hasUpvoted]
    Includes: latitude, longitude, photoUrl, severityLabel, createdAt.
    Omits: reporter, zoneId, zoneName, assignedOfficerId, citizenActionNeeded, updatedAt.
    """
    from app.api.shared.serializers import serialize_category
    from app.core.signing import sign_photo_url
    from app.domain import severity as severity_domain

    cat = ctx.categories[complaint.category_id]
    sev_lbl = severity_domain.label(complaint.severity_score).value
    upvote_count = ctx.upvote_counts.get(complaint.id, 0)
    first_ev = ctx.first_evidence.get(complaint.id)
    photo_url = sign_photo_url(first_ev.id) if first_ev else ""
    has_upvoted = (complaint.id in citizen_upvoted_ids) if citizen_upvoted_ids else False
    created_at_str = complaint.created_at.isoformat() + "Z" if complaint.created_at else None

    return {
        "id": str(complaint.id),
        "category": serialize_category(cat),
        "status": complaint.status.value,
        "severityLabel": sev_lbl,
        "upvoteCount": upvote_count,
        "hasUpvoted": has_upvoted,
        "photoUrl": photo_url,
        "latitude": complaint.latitude,
        "longitude": complaint.longitude,
        "createdAt": created_at_str,
    }
