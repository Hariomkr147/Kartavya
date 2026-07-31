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

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

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


from app.domain import severity, sla
from app.core import signing
from app.domain.enums import UserRole

def serialize_complaint(complaint: Complaint, ctx: SerializationContext) -> dict[str, Any]:
    """The compact `Complaint` shape (openapi.yaml: Complaint)."""
    # Safe category serialization
    cat = ctx.categories.get(complaint.category_id)
    category_dict = serialize_category(cat) if cat else {"id": str(complaint.category_id), "name": "Unknown"}
    
    # Safe zone serialization
    z = ctx.zones.get(complaint.zone_id)
    zone_dict = serialize_zone(z) if z else {"id": str(complaint.zone_id), "name": "Unknown"}

    # SLA Label
    sla_label = None
    if complaint.sla_target_hours is not None and complaint.sla_started_at is not None:
        l = sla.label(
            target_hours=complaint.sla_target_hours,
            started_at=complaint.sla_started_at,
            paused_seconds=complaint.sla_paused_seconds,
            paused_at=complaint.sla_paused_at,
            now=ctx.now
        )
        if l:
            sla_label = l.value
            
    # Severity Label
    sev_label = severity.label(complaint.severity_score).value

    # Upvotes
    upvotes = ctx.upvote_counts.get(complaint.id, 0)

    # Photo URL
    photo_url = None
    first_ev = ctx.first_evidence.get(complaint.id)
    if first_ev:
        photo_url = signing.sign_photo_url(first_ev.id)

    return {
        "id": str(complaint.id),
        "status": complaint.status.value,
        "category": category_dict,
        "zoneId": str(complaint.zone_id),
        "zoneName": zone_dict.get("name", "Unknown"),
        "assignedOfficerId": str(complaint.assigned_officer_id) if complaint.assigned_officer_id else None,
        "createdAt": complaint.created_at.isoformat() if complaint.created_at else None,
        "updatedAt": complaint.updated_at.isoformat() if complaint.updated_at else None,
        "severityLabel": sev_label,
        "slaLabel": sla_label,
        "clusterId": str(complaint.cluster_id) if complaint.cluster_id else None,
        "upvoteCount": upvotes,
        "photoUrl": photo_url,
    }


def serialize_complaint_detail(complaint: Complaint, ctx: SerializationContext) -> dict[str, Any]:
    """`ComplaintDetail` — the compact shape plus evidence, history and notes."""
    base = serialize_complaint(complaint, ctx)
    
    evidence_list = []
    if getattr(complaint, "evidence", None):
        for e in sorted(complaint.evidence, key=lambda x: x.sequence):
            evidence_list.append(serialize_evidence(e, ctx))
            
    history_list = []
    if getattr(complaint, "status_history", None):
        for h in sorted(complaint.status_history, key=lambda x: x.created_at):
            history_list.append(serialize_status_history(h))
            
    notes_list = []
    if getattr(complaint, "notes", None):
        for n in sorted(complaint.notes, key=lambda x: x.created_at):
            notes_list.append({
                "id": str(n.id),
                "officerId": str(n.officer_id),
                "text": n.note_text,
                "createdAt": n.created_at.isoformat()
            })
            
    base["description"] = complaint.description
    base["latitude"] = float(complaint.latitude)
    base["longitude"] = float(complaint.longitude)
    base["severityScore"] = complaint.severity_score
    base["slaTargetHours"] = complaint.sla_target_hours

    base["evidence"] = evidence_list
    base["statusHistory"] = history_list
    base["progressNotes"] = notes_list
    return base



def serialize_category(category: ComplaintCategory) -> dict[str, Any]:
    """`Category`. Note the field renames: category_code -> `code`,
    sla_hours -> `slaTargetHours`. TODO(phase 2).
    """
    raise NotImplementedError


def serialize_zone(zone: Zone) -> dict[str, Any]:
    """`Zone`. TODO(phase 2)."""
    raise NotImplementedError


def serialize_evidence(evidence: Any, ctx: SerializationContext) -> dict[str, Any]:
    """`Evidence`, including the AiConfidenceNote."""
    base = {
        "id": str(evidence.id),
        "sequence": evidence.sequence,
        "photoUrl": signing.sign_photo_url(evidence.id) if getattr(signing, 'sign_photo_url', None) else evidence.file_path,
        "submittedAt": evidence.created_at.isoformat(),
    }
    
    # AI Note format
    base["aiConfidenceNote"] = {
        "aiAvailable": evidence.ai_screen_status.value != "UNAVAILABLE",
    }
    if evidence.ai_confidence is not None:
        base["aiConfidenceNote"].update({
            "matchesCategory": evidence.ai_matches_category,
            "confidence": evidence.ai_confidence,
            "note": evidence.ai_note
        })
    
    if evidence.verdict:
        base["verdict"] = evidence.verdict.value
        base["verdictReason"] = evidence.verdict_reason
        base["reviewedByOfficerId"] = str(evidence.reviewed_by) if getattr(evidence, 'reviewed_by', None) else None
        base["reviewedAt"] = evidence.reviewed_at.isoformat() if evidence.reviewed_at else None

    return base


def serialize_status_history(entry: Any) -> dict[str, Any]:
    """`StatusHistoryEntry`."""
    res = {
        "id": str(entry.id),
        "toStatus": entry.to_status.value,
        "changedByRole": entry.actor_role.value,
        "timestamp": entry.created_at.isoformat(),
    }
    if getattr(entry, "from_status", None):
        res["fromStatus"] = entry.from_status.value
    if getattr(entry, "reason", None):
        res["reason"] = entry.reason
    if getattr(entry, "remark", None):
        res["remark"] = entry.remark
        
    # Only emit changedByOfficerId if actor_role is OFFICER
    if entry.actor_role.value == "OFFICER" and getattr(entry, "changed_by_user_id", None):
        res["changedByOfficerId"] = str(entry.changed_by_user_id)
        
    return res


def masked_display_name(user: Any) -> str:
    """`display_name`, or a masked fallback like "Citizen #1042".

    TODO(phase 2). The fallback is NEVER `full_name`. That column is visible
    only on GET /users/me (self) and in admin views.
    """
    raise NotImplementedError
