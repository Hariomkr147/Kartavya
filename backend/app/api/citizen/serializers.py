"""Citizen audience serializers.

Strict privacy rule: the `reporter` identity field is STRUCTURALLY ABSENT
from every serializer in this module. Not null, not masked, ABSENT.
"""

from __future__ import annotations

from typing import Any

from app.core.context import SerializationContext
from app.models.complaints import Complaint


def serialize_feed_item(
    complaint: Complaint,
    ctx: SerializationContext,
    citizen_upvoted_ids: set[int] | None = None,
) -> dict[str, Any]:
    """`FeedItem` — anonymized matching openapi.yaml schema."""
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
