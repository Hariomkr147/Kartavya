"""Neutral response shapes — the ones every audience reuses.

Two hard rules:

1. **Serializers never query.** They receive everything pre-loaded through a
   `SerializationContext`. This keeps privacy decisions visible in one place and
   stops a 20-item page from becoming 60 queries.
2. **These shapes have NO reporter field at all** — structurally, not by
   stripping it afterwards. The officer queue, the public feed and cluster
   details all reuse them, so there is nothing here to accidentally leak.

Only `app/api/admin/serializers.py` may ever emit reporter identity.
"""

from __future__ import annotations

from typing import Any

from app.core.context import SerializationContext
from app.core.signing import sign_photo_url
from app.domain import severity as severity_domain
from app.domain import sla as sla_domain
from app.domain.enums import AiScreenStatus, StatusActor
from app.models import Complaint, ComplaintCategory, Zone

@dataclass
class SerializationContext:
    """Everything the serializers need, gathered once by the caller.

    The service builds this; the serializer only reads it. `now` is passed in so
    derived SLA labels are consistent across a whole page — computing
    `datetime.now()` per item would let the first and last row of one response
    disagree about what time it is.
    """

    now: datetime
    categories: dict[int, ComplaintCategory] = field(default_factory=dict)
    zones: dict[int, Zone] = field(default_factory=dict)
    #: complaint_id -> COUNT(*), from ONE GROUP BY.
    upvote_counts: dict[int, int] = field(default_factory=dict)
    #: complaint_id -> first evidence row, for `photoUrl`.
    first_evidence: dict[int, Any] = field(default_factory=dict)


def serialize_complaint(complaint: Complaint, ctx: SerializationContext) -> dict[str, Any]:
    """The compact Complaint shape (openapi.yaml: Complaint)."""
    cat = ctx.categories[complaint.category_id]
    zone = ctx.zones.get(complaint.zone_id)

    sev_lbl = severity_domain.label(complaint.severity_score).value

    sla_lbl_obj = sla_domain.label(
        target_hours=complaint.sla_target_hours,
        started_at=complaint.sla_started_at,
        paused_seconds=complaint.sla_paused_seconds,
        paused_at=complaint.sla_paused_at,
        now=ctx.now,
    )
    sla_label = sla_lbl_obj.value if sla_lbl_obj else None

    upvote_count = ctx.upvote_counts.get(complaint.id, 0)
    first_ev = ctx.first_evidence.get(complaint.id)

    photo_url = sign_photo_url(first_ev.id) if first_ev else ""

    officer_id = (
        str(complaint.assigned_officer_id) if complaint.assigned_officer_id else None
    )
    created_at_str = (
        complaint.created_at.isoformat() + "Z" if complaint.created_at else None
    )
    updated_at_str = (
        complaint.updated_at.isoformat() + "Z" if complaint.updated_at else None
    )

    res = {
        "id": str(complaint.id),
        "category": serialize_category(cat),
        "status": complaint.status.value,
        "severityLabel": sev_lbl,
        "slaLabel": sla_label,
        "upvoteCount": upvote_count,
        "photoUrl": photo_url,
        "zoneId": str(complaint.zone_id),
        "zoneName": zone.zone_name if zone else "",
        "assignedOfficerId": officer_id,
        "createdAt": created_at_str,
        "updatedAt": updated_at_str,
    }
    return res


def serialize_complaint_detail(
    complaint: Complaint,
    ctx: SerializationContext,
    evidence_list: list[Any] | None = None,
    history_list: list[Any] | None = None,
    notes_list: list[Any] | None = None,
) -> dict[str, Any]:
    """ComplaintDetail — the compact shape plus evidence, history and notes."""
    data = serialize_complaint(complaint, ctx)

    ev_items = evidence_list or []
    ev_serialized = [serialize_evidence(e, ctx) for e in ev_items]

    data["description"] = complaint.description

    data["latitude"] = complaint.latitude
    data["longitude"] = complaint.longitude
    data["severityScore"] = complaint.severity_score
    data["slaTargetHours"] = complaint.sla_target_hours
    data["clusterId"] = str(complaint.cluster_id) if complaint.cluster_id else None
    data["evidence"] = ev_serialized
    data["statusHistory"] = [serialize_status_history(h) for h in (history_list or [])]
    data["progressNotes"] = [serialize_progress_note(n) for n in (notes_list or [])]
    return data


def serialize_category(category: ComplaintCategory) -> dict[str, Any]:
    """`Category`."""
    return {
        "id": str(category.id),
        "code": category.category_code,
        "name": category.category_name,
        "description": category.description,
        "slaTargetHours": category.sla_hours,
    }


def serialize_zone(zone: Zone) -> dict[str, Any]:
    """``Zone`` (openapi.yaml: Zone)."""
    return {
        "id": str(zone.id),
        "code": zone.zone_code,
        "name": zone.zone_name,
        "isCatchAll": zone.is_catch_all,
        "isActive": zone.is_active,
    }


def serialize_evidence(evidence: Any, ctx: SerializationContext) -> dict[str, Any]:
    """Evidence, including the AiConfidenceNote."""
    ai_available = getattr(evidence, "ai_screen_status", None) != AiScreenStatus.UNAVAILABLE
    ai_note = {
        "aiAvailable": ai_available,
        "matchesCategory": getattr(evidence, "ai_matches_category", None),
        "confidence": getattr(evidence, "ai_confidence", None),
        "note": getattr(evidence, "ai_note", None),
    }

    verdict_val = evidence.verdict.value if getattr(evidence, "verdict", None) else None
    rev_officer_id = (
        str(evidence.reviewed_by) if getattr(evidence, "reviewed_by", None) else None
    )
    rev_at_str = (
        evidence.reviewed_at.isoformat() + "Z"
        if getattr(evidence, "reviewed_at", None)
        else None
    )
    sub_at_str = (
        evidence.created_at.isoformat() + "Z"
        if getattr(evidence, "created_at", None)
        else None
    )

    return {
        "id": str(evidence.id),
        "photoUrl": sign_photo_url(evidence.id),
        "sequence": evidence.sequence,
        "aiConfidenceNote": ai_note,
        "verdict": verdict_val,
        "verdictReason": getattr(evidence, "verdict_reason", None),
        "reviewedByOfficerId": rev_officer_id,
        "reviewedAt": rev_at_str,
        "submittedAt": sub_at_str,
    }


def serialize_status_history(entry: Any) -> dict[str, Any]:
    """StatusHistoryEntry."""
    is_officer = getattr(entry, "actor_role", None) == StatusActor.OFFICER
    user_id = getattr(entry, "changed_by_user_id", None)
    officer_id = str(entry.changed_by_user_id) if is_officer and user_id else None
    ts_str = (
        entry.created_at.isoformat() + "Z" if getattr(entry, "created_at", None) else None
    )

    return {
        "id": str(entry.id),
        "fromStatus": entry.from_status.value if getattr(entry, "from_status", None) else None,
        "toStatus": entry.to_status.value if getattr(entry, "to_status", None) else None,
        "changedByRole": entry.actor_role.value if getattr(entry, "actor_role", None) else None,
        "changedByOfficerId": officer_id,
        "reason": getattr(entry, "reason", None),
        "remark": getattr(entry, "remark", None),
        "timestamp": ts_str,
    }


def serialize_progress_note(note: Any) -> dict[str, Any]:
    """ProgressNote."""
    created_str = (
        note.created_at.isoformat() + "Z" if getattr(note, "created_at", None) else None
    )
    return {
        "id": str(note.id),
        "officerId": str(note.officer_id),
        "text": note.note_text,
        "createdAt": created_str,
    }


def masked_display_name(user: Any) -> str:
    """`display_name`, or a masked fallback like "Citizen #1042"."""
    if getattr(user, "display_name", None):
        return user.display_name
    return f"Citizen #{user.id}"
