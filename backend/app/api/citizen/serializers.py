"""Citizen-specific response shapes built on the neutral serializers."""

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
    """Return a citizen's complaint plus its derived action requirement."""
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
    if complaint.status is ComplaintStatus.RESOLVED:
        action_needed = "CONFIRM_FIX"
    elif complaint.status is ComplaintStatus.NEEDS_MORE_EVIDENCE:
        action_needed = "PROVIDE_MORE_EVIDENCE"

    data["citizenActionNeeded"] = action_needed
    return data


def serialize_feed_item(
    complaint: Complaint,
    ctx: SerializationContext,
    citizen_upvoted_ids: set[int] | None = None,
) -> dict[str, Any]:
    """Return the anonymized FeedItem contract shape."""
    from app.api.shared.serializers import serialize_category
    from app.core.signing import sign_photo_url
    from app.domain import severity as severity_domain

    category = ctx.categories[complaint.category_id]
    evidence = ctx.first_evidence.get(complaint.id)
    return {
        "id": str(complaint.id),
        "category": serialize_category(category),
        "status": complaint.status.value,
        "severityLabel": severity_domain.label(complaint.severity_score).value,
        "upvoteCount": ctx.upvote_counts.get(complaint.id, 0),
        "hasUpvoted": complaint.id in (citizen_upvoted_ids or set()),
        "photoUrl": sign_photo_url(evidence.id) if evidence else "",
        "latitude": complaint.latitude,
        "longitude": complaint.longitude,
        "createdAt": complaint.created_at.isoformat() + "Z" if complaint.created_at else None,
    }
