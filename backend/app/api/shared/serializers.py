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
from datetime import UTC, datetime
from typing import Any

from app.core.signing import sign_photo_url
from app.domain.enums import AiScreenStatus, StatusActor
from app.domain.severity import label as severity_label
from app.domain.sla import label as sla_label
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
    #: Optional preloaded users. Only the admin serializer reads reporter rows.
    users: dict[int, Any] = field(default_factory=dict)
    #: complaint_id -> COUNT(*), from ONE GROUP BY.
    upvote_counts: dict[int, int] = field(default_factory=dict)
    #: complaint_id -> first evidence row, for `photoUrl`.
    first_evidence: dict[int, Any] = field(default_factory=dict)
    evidence_rows: dict[int, list[Any]] = field(default_factory=dict)
    history_rows: dict[int, list[Any]] = field(default_factory=dict)
    note_rows: dict[int, list[Any]] = field(default_factory=dict)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z")


def serialize_complaint(complaint: Complaint, ctx: SerializationContext) -> dict[str, Any]:
    """The compact `Complaint` shape (openapi.yaml: Complaint). TODO(phase 3).

    Derived on read, never stored:
      * `severityLabel` <- `domain.severity.label(complaint.severity_score)`
      * `slaLabel`      <- `domain.sla.label(...)` over the four sla_* columns
      * `upvoteCount`   <- ctx.upvote_counts
      * `photoUrl`      <- `core.signing.sign_photo_url(evidence.id)`, NEVER the
        raw file_path. This is the one place a photo URL is minted, and it is
        minted here precisely because scoping has already decided this caller
        may see the parent complaint.

    Do not add a `reporter` key. Not "temporarily", not "for debugging".
    """
    category = ctx.categories[complaint.category_id]
    zone = ctx.zones[complaint.zone_id]
    evidence = ctx.first_evidence.get(complaint.id)
    current_sla = sla_label(
        complaint.sla_target_hours,
        complaint.sla_started_at,
        complaint.sla_paused_seconds,
        complaint.sla_paused_at,
        ctx.now,
    )
    return {
        "id": str(complaint.id),
        "category": serialize_category(category),
        "status": complaint.status.value,
        "severityLabel": severity_label(complaint.severity_score).value,
        "slaLabel": current_sla.value if current_sla else None,
        "upvoteCount": ctx.upvote_counts.get(complaint.id, 0),
        "photoUrl": sign_photo_url(evidence.id) if evidence else None,
        "zoneId": str(zone.id),
        "zoneName": zone.zone_name,
        "assignedOfficerId": (
            str(complaint.assigned_officer_id)
            if complaint.assigned_officer_id is not None
            else None
        ),
        "createdAt": _iso(complaint.created_at),
        "updatedAt": _iso(complaint.updated_at),
        "citizenActionNeeded": None,
    }


def serialize_complaint_detail(complaint: Complaint, ctx: SerializationContext) -> dict[str, Any]:
    """`ComplaintDetail` — the compact shape plus evidence, history and notes.

    TODO(phase 3). Progress notes carry `officerId`, never an officer name.
    """
    payload = serialize_complaint(complaint, ctx)
    payload.update(
        {
            "description": complaint.description,
            "latitude": complaint.latitude,
            "longitude": complaint.longitude,
            "severityScore": complaint.severity_score,
            "slaTargetHours": complaint.sla_target_hours,
            "clusterId": str(complaint.cluster_id) if complaint.cluster_id else None,
            "evidence": [
                serialize_evidence(row, ctx) for row in ctx.evidence_rows.get(complaint.id, [])
            ],
            "statusHistory": [
                serialize_status_history(row) for row in ctx.history_rows.get(complaint.id, [])
            ],
            "progressNotes": [
                {
                    "id": str(row.id),
                    "officerId": str(row.officer_id),
                    "text": row.note_text,
                    "createdAt": _iso(row.created_at),
                }
                for row in ctx.note_rows.get(complaint.id, [])
            ],
        }
    )
    return payload


def serialize_category(category: ComplaintCategory) -> dict[str, Any]:
    """`Category`. Note the field renames: category_code -> `code`,
    sla_hours -> `slaTargetHours`. TODO(phase 2).
    """
    return {
        "id": str(category.id),
        "code": category.category_code,
        "name": category.category_name,
        "description": category.description,
        "slaTargetHours": category.sla_hours,
    }


def serialize_zone(zone: Zone) -> dict[str, Any]:
    """`Zone`. TODO(phase 2)."""
    return {
        "id": str(zone.id),
        "code": zone.zone_code,
        "name": zone.zone_name,
        "isCatchAll": zone.is_catch_all,
        "isActive": zone.is_active,
    }


def serialize_evidence(evidence: Any, ctx: SerializationContext) -> dict[str, Any]:
    """`Evidence`, including the AiConfidenceNote.

    TODO(phase 3). `aiAvailable` is `ai_screen_status != UNAVAILABLE` — the UI
    uses it to tell "no result yet" apart from "the model was down", so do not
    collapse the two.
    """
    return {
        "id": str(evidence.id),
        "photoUrl": sign_photo_url(evidence.id),
        "sequence": evidence.sequence,
        "aiConfidenceNote": {
            "aiAvailable": evidence.ai_screen_status is not AiScreenStatus.UNAVAILABLE,
            "matchesCategory": evidence.ai_matches_category,
            "confidence": evidence.ai_confidence,
            "note": evidence.ai_note,
        },
        "verdict": evidence.verdict.value if evidence.verdict else None,
        "verdictReason": evidence.verdict_reason,
        "reviewedByOfficerId": (
            str(evidence.reviewed_by) if evidence.reviewed_by is not None else None
        ),
        "reviewedAt": _iso(evidence.reviewed_at),
        "submittedAt": _iso(evidence.created_at),
    }


def serialize_status_history(entry: Any) -> dict[str, Any]:
    """`StatusHistoryEntry`. TODO(phase 3).

    `changedByOfficerId` is `changed_by_user_id` ONLY when actor_role is
    OFFICER. For CITIZEN and ADMIN entries it stays absent — a citizen must not
    learn which admin ruled on their dispute, and an officer must not learn
    which citizen filed.
    """
    payload = {
        "id": str(entry.id),
        "fromStatus": entry.from_status.value if entry.from_status else None,
        "toStatus": entry.to_status.value,
        "changedByRole": entry.actor_role.value,
        "reason": entry.reason,
        "remark": entry.remark,
        "timestamp": _iso(entry.created_at),
    }
    if entry.actor_role is StatusActor.OFFICER and entry.changed_by_user_id is not None:
        payload["changedByOfficerId"] = str(entry.changed_by_user_id)
    return payload


def masked_display_name(user: Any) -> str:
    """`display_name`, or a masked fallback like "Citizen #1042".

    TODO(phase 2). The fallback is NEVER `full_name`. That column is visible
    only on GET /users/me (self) and in admin views.
    """
    return user.display_name or f"Citizen #{user.id}"
