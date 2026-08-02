"""Neutral response shapes shared by citizen, officer, and admin APIs.

Serializers never query and never expose reporter identity. Only the admin
serializer may add reporter data after authorization and scoping are complete.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.core.context import SerializationContext
from app.core.signing import sign_photo_url
from app.domain import severity as severity_domain
from app.domain import sla as sla_domain
from app.domain.enums import AiScreenStatus, StatusActor
from app.models import Complaint, ComplaintCategory, Zone


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def serialize_complaint(complaint: Complaint, ctx: SerializationContext) -> dict[str, Any]:
    """Return the compact Complaint contract shape without reporter identity."""
    category = ctx.categories.get(complaint.category_id)
    zone = ctx.zones.get(complaint.zone_id)
    evidence = ctx.first_evidence.get(complaint.id)
    current_sla = sla_domain.label(
        target_hours=complaint.sla_target_hours,
        started_at=complaint.sla_started_at,
        paused_seconds=complaint.sla_paused_seconds,
        paused_at=complaint.sla_paused_at,
        now=ctx.now,
    )
    return {
        "id": str(complaint.id),
        "category": (
            serialize_category(category)
            if category is not None
            else {
                "id": str(complaint.category_id or ""),
                "code": "UNKNOWN",
                "name": "Unknown",
                "description": None,
                "slaTargetHours": None,
            }
        ),
        "status": complaint.status.value,
        "severityLabel": severity_domain.label(complaint.severity_score).value,
        "slaLabel": current_sla.value if current_sla else None,
        "upvoteCount": ctx.upvote_counts.get(complaint.id, 0),
        "photoUrl": sign_photo_url(evidence.id) if evidence else "",
        "zoneId": str(zone.id if zone is not None else complaint.zone_id or ""),
        "zoneName": zone.zone_name if zone is not None else "Unknown",
        "assignedOfficerId": (
            str(complaint.assigned_officer_id)
            if complaint.assigned_officer_id is not None
            else None
        ),
        "createdAt": _iso(complaint.created_at),
        "updatedAt": _iso(complaint.updated_at),
    }


def serialize_complaint_detail(
    complaint: Complaint,
    ctx: SerializationContext,
    evidence_list: list[Any] | None = None,
    history_list: list[Any] | None = None,
    notes_list: list[Any] | None = None,
) -> dict[str, Any]:
    """Return ComplaintDetail, using explicit rows or preloaded context rows."""
    complaint_id = complaint.id
    evidence = (
        evidence_list if evidence_list is not None else ctx.evidence_rows.get(complaint_id, [])
    )
    history = history_list if history_list is not None else ctx.history_rows.get(complaint_id, [])
    notes = notes_list if notes_list is not None else ctx.note_rows.get(complaint_id, [])

    payload = serialize_complaint(complaint, ctx)
    payload.update(
        {
            "description": complaint.description,
            "latitude": complaint.latitude,
            "longitude": complaint.longitude,
            "severityScore": complaint.severity_score,
            "slaTargetHours": complaint.sla_target_hours,
            "clusterId": str(complaint.cluster_id) if complaint.cluster_id else None,
            "evidence": [serialize_evidence(row, ctx) for row in evidence],
            "statusHistory": [serialize_status_history(row) for row in history],
            "progressNotes": [serialize_progress_note(row) for row in notes],
        }
    )
    return payload


def serialize_category(category: ComplaintCategory) -> dict[str, Any]:
    return {
        "id": str(category.id),
        "code": category.category_code,
        "name": category.category_name,
        "description": category.description,
        "slaTargetHours": category.sla_hours,
    }


def serialize_zone(zone: Zone) -> dict[str, Any]:
    return {
        "id": str(zone.id),
        "code": zone.zone_code,
        "name": zone.zone_name,
        "isCatchAll": zone.is_catch_all,
        "isActive": zone.is_active,
    }


def serialize_evidence(evidence: Any, ctx: SerializationContext) -> dict[str, Any]:
    del ctx
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
        "reviewedByOfficerId": str(evidence.reviewed_by)
        if evidence.reviewed_by is not None
        else None,
        "reviewedAt": _iso(evidence.reviewed_at),
        "submittedAt": _iso(evidence.created_at),
    }


def serialize_status_history(entry: Any) -> dict[str, Any]:
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


def serialize_progress_note(note: Any) -> dict[str, Any]:
    return {
        "id": str(note.id),
        "officerId": str(note.officer_id),
        "text": note.note_text,
        "createdAt": _iso(note.created_at),
    }


def serialize_cluster(cluster: Any, ctx: SerializationContext) -> dict[str, Any]:
    """Return the OpenAPI Cluster shape from the cluster's preloaded members."""
    members = ctx.cluster_members.get(cluster.id, [])
    total_upvotes = sum(ctx.upvote_counts.get(member.id, 0) for member in members)
    severity_score = severity_domain.score(cluster.unique_reporter_count, total_upvotes)
    status_summary: dict[str, int] = {}
    for member in members:
        status = member.status.value
        status_summary[status] = status_summary.get(status, 0) + 1

    category = ctx.categories.get(cluster.category_id)
    return {
        "id": str(cluster.id),
        "zoneId": str(cluster.zone_id),
        "category": (
            serialize_category(category)
            if category is not None
            else {
                "id": str(cluster.category_id),
                "code": "UNKNOWN",
                "name": "Unknown",
                "description": None,
                "slaTargetHours": None,
            }
        ),
        "reportCount": cluster.report_count,
        "uniqueReporterCount": cluster.unique_reporter_count,
        "severityScore": severity_score,
        "severityLabel": severity_domain.label(severity_score).value,
        "statusSummary": status_summary,
        "centroidLat": cluster.centroid_lat,
        "centroidLng": cluster.centroid_lng,
        "createdAt": _iso(cluster.created_at),
    }


def serialize_cluster_detail(cluster: Any, ctx: SerializationContext) -> dict[str, Any]:
    payload = serialize_cluster(cluster, ctx)
    payload["complaints"] = [
        serialize_complaint(member, ctx) for member in ctx.cluster_members.get(cluster.id, [])
    ]
    return payload


def masked_display_name(user: Any) -> str:
    if getattr(user, "display_name", None):
        return user.display_name
    return f"Citizen #{user.id}"
