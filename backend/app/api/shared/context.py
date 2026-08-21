"""The adapter between a service's preloaded data and a serializer's context.

Serializers never query (§7.4), so somebody has to turn what the service loaded
into the `SerializationContext` they read from. That somebody is here rather than
in each audience's routes: citizen, officer and admin all serialize the same
`ComplaintDetail` rows, and three copies of this mapping would drift.

It lives outside `shared/serializers.py` on purpose — the import-linter contract
forbids the serializer modules from importing `app.services` at all, and that
rule is worth more than the convenience of putting this next to them.
"""

from __future__ import annotations

from datetime import datetime

from app.api.shared.serializers import SerializationContext
from app.services.complaints.views import ComplaintDetailData


def detail_context(detail: ComplaintDetailData, *, now: datetime) -> SerializationContext:
    """Everything `serialize_complaint_detail` needs for one complaint.

    `now` is passed in rather than read here so every derived SLA label in one
    response agrees about what time it is.
    """
    complaint_id = detail.complaint.id
    first_evidence = detail.evidence[0] if detail.evidence else None
    return SerializationContext(
        now=now,
        categories={detail.category.id: detail.category},
        zones={detail.zone.id: detail.zone},
        upvote_counts={complaint_id: detail.upvote_count},
        first_evidence={complaint_id: first_evidence} if first_evidence else {},
        evidence_rows={complaint_id: detail.evidence},
        history_rows={complaint_id: detail.history},
        note_rows={complaint_id: detail.notes},
    )
