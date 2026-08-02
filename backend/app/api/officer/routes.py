"""Officer endpoints — zone-scoped, and identity-free.

The single most important property of this package: NOTHING here emits reporter
identity. Not the queue, not the detail view, not the cascade result. The
compact `Complaint` shape has no reporter field at all, which is why there is
nothing to strip.

A cheap, high-value test for every route in this file:
`assert "reporter" not in response.get_json()`.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from flask import Blueprint, jsonify

from app.api.officer.schemas import (
    BatchStatusUpdateRequest,
    EvidenceReviewRequest,
    OfficerAnalyticsQuery,
    OfficerQueueQuery,
    ProgressNoteRequest,
    StatusUpdateRequest,
)
from app.api.officer.serializers import (
    serialize_officer_complaint_detail,
    serialize_queue_item,
    serialize_status_update_result,
)
from app.api.shared.context import detail_context
from app.core.auth import current_user, require_auth, require_officer_zone, require_role
from app.core.serialization import iso_utc
from app.core.validation import validate_body, validate_query
from app.domain.enums import UserRole
from app.services.analytics import officer as analytics_officer
from app.services.analytics.zone import zone_analytics
from app.services.complaints import lifecycle
from app.services.complaints.reads import get_officer_queue
from app.services.complaints.views import ComplaintDetailData

bp = Blueprint("officer", __name__)

OFFICER = UserRole.OFFICER


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _serialize_progress_note(note: lifecycle.ProgressNoteResult) -> dict[str, Any]:
    return {
        "id": str(note.id),
        "officerId": str(note.officer_id),
        "text": note.note_text,
        # iso_utc, not a bare isoformat(): without the `Z` a browser reads this
        # as local time, and the same note served inside ComplaintDetail would
        # carry a different format from the one served here.
        "createdAt": iso_utc(note.created_at),
    }


def _detail_response(detail: ComplaintDetailData, *, now: datetime) -> dict[str, Any]:
    """ComplaintDetail for an officer — evidence, history and notes included."""
    return serialize_officer_complaint_detail(detail.complaint, detail_context(detail, now=now))


@bp.get("/officer/complaints")
@require_role(OFFICER)
@validate_query(OfficerQueueQuery)
def get_officer_complaint_queue(query: OfficerQueueQuery):
    """200 ComplaintListResponse — this officer's zone, most urgent first.

    Filtering, sorting and paging all happen in `services/complaints/reads.py`
    on top of the shared builders in `services/queries.py`, so the derived
    `slaLabel` / `severityLabel` filters narrow the whole result set rather than
    just the page that was already fetched.
    """
    now = _utcnow()
    complaints, pagination, ctx = get_officer_queue(
        officer=current_user(), query_params=query, now=now
    )
    return jsonify(
        {
            "data": [serialize_queue_item(row, ctx) for row in complaints],
            "pagination": pagination.to_dict(),
        }
    )


@bp.post("/officer/complaints/<complaint_id>/claim")
@require_role(OFFICER)
def claim_complaint(complaint_id: str):
    """200 ComplaintDetail — SUBMITTED -> EVIDENCE_UNDER_REVIEW."""
    now = _utcnow()
    detail = lifecycle.claim(complaint_id=int(complaint_id), officer=current_user(), now=now)
    return jsonify(_detail_response(detail, now=now))


@bp.post("/officer/complaints/<complaint_id>/evidence-review")
@require_role(OFFICER)
@validate_body(EvidenceReviewRequest)
def review_evidence(complaint_id: str, body: EvidenceReviewRequest):
    """200 ComplaintDetail — the photo verdict."""
    now = _utcnow()
    detail = lifecycle.review_evidence(
        complaint_id=int(complaint_id),
        officer=current_user(),
        verdict=body.verdict,
        reason=body.reason,
        now=now,
    )
    return jsonify(_detail_response(detail, now=now))


@bp.patch("/officer/complaints/<complaint_id>/status")
@require_role(OFFICER)
@validate_body(StatusUpdateRequest)
def update_complaint_status(complaint_id: str, body: StatusUpdateRequest):
    """200 StatusUpdateResult — the complaint, plus `cascade` when a cluster moved."""
    now = _utcnow()
    result = lifecycle.transition_by_officer(
        complaint_id=int(complaint_id),
        officer=current_user(),
        target=body.status,
        reason=body.reason,
        note=body.note,
        now=now,
    )
    return jsonify(
        serialize_status_update_result(
            result.complaint,
            result.cascade,
            detail_context(result.detail, now=now),
        )
    )


@bp.post("/officer/complaints/batch-status")
@require_role(OFFICER)
@validate_body(BatchStatusUpdateRequest)
def batch_update_status(body: BatchStatusUpdateRequest):
    """200 BatchStatusUpdateResult — the only endpoint where partial failure is
    a SUCCESS response.

    Validates all items, applies valid ones, then commits once in the service.
    Per-item failures are `TransitionFailureCode` values in the 200 body.
    An unknown complaint id is a per-item UNKNOWN_COMPLAINT; an unknown
    `clusterId` IS a 404. Exactly one of `complaintIds` / `clusterId`.
    """
    user = current_user()
    now = _utcnow()
    result = lifecycle.transition_batch(
        officer=user,
        complaint_ids=[int(item) for item in body.complaintIds] if body.complaintIds else None,
        cluster_id=int(body.clusterId) if body.clusterId else None,
        target=body.status,
        reason=body.reason,
        note=body.note,
        now=now,
    )
    return jsonify(result)


@bp.post("/officer/complaints/<complaint_id>/notes")
@require_role(OFFICER)
@validate_body(ProgressNoteRequest)
def add_progress_note(complaint_id: str, body: ProgressNoteRequest):
    user = current_user()
    now = _utcnow()

    note = lifecycle.add_progress_note(
        complaint_id=int(complaint_id), officer=user, note_text=body.text, now=now
    )

    return jsonify(_serialize_progress_note(note)), 201


@bp.post("/officer/clusters/<cluster_id>/notes")
@require_role(OFFICER)
@validate_body(ProgressNoteRequest)
def add_cluster_progress_note(cluster_id: str, body: ProgressNoteRequest):
    """201 — one note fanned out to every eligible complaint in the cluster."""
    user = current_user()
    now = _utcnow()
    notes = lifecycle.add_cluster_progress_notes(
        cluster_id=int(cluster_id), officer=user, note_text=body.text, now=now
    )
    return jsonify([_serialize_progress_note(note) for note in notes]), 201


@bp.get("/officer/analytics")
@require_role(OFFICER)
@validate_query(OfficerAnalyticsQuery)
def get_officer_analytics(query: OfficerAnalyticsQuery):
    """200 ZoneAnalytics — for THIS officer's zone only."""
    user = current_user()
    now = _utcnow()
    return jsonify(
        zone_analytics(
            zone_id=require_officer_zone(user),
            now=now,
            date_from=query.dateFrom,
            date_to=query.dateTo,
        )
    )


@bp.get("/officers/<officer_id>/stats")
@require_auth
def get_public_officer_stats(officer_id: str):
    stats = analytics_officer.public_officer_stats(officer_id=int(officer_id))
    return jsonify(stats)
