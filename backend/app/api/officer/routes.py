"""Officer endpoints — zone-scoped, and identity-free.

The single most important property of this package: NOTHING here emits reporter
identity. Not the queue, not the detail view, not the cascade result. The
compact `Complaint` shape has no reporter field at all, which is why there is
nothing to strip.

A cheap, high-value test for every route in this file:
`assert "reporter" not in response.get_json()`.
"""

from __future__ import annotations

from contextlib import suppress
from datetime import UTC, datetime
from typing import Any

from flask import Blueprint, jsonify, request
from sqlalchemy import select

from app.api.officer.schemas import (
    BatchStatusUpdateRequest,
    EvidenceReviewRequest,
    OfficerAnalyticsQuery,
    ProgressNoteRequest,
    StatusUpdateRequest,
)
from app.api.officer.serializers import serialize_queue_item, serialize_status_update_result
from app.api.shared.serializers import SerializationContext
from app.core import scoping
from app.core.auth import current_user, require_auth, require_officer_zone, require_role
from app.core.session import transaction
from app.core.validation import validate_body, validate_query
from app.domain.enums import ComplaintStatus, UserRole
from app.extensions import db
from app.models import Complaint, ComplaintCategory, ComplaintEvidence, Zone
from app.services.analytics import officer as analytics_officer
from app.services.analytics.zone import zone_analytics
from app.services.complaints import lifecycle

bp = Blueprint("officer", __name__)

OFFICER = UserRole.OFFICER


def _serialize_progress_note(note: lifecycle.ProgressNoteResult) -> dict[str, Any]:
    return {
        "id": str(note.id),
        "officerId": str(note.officer_id),
        "text": note.note_text,
        "createdAt": note.created_at.isoformat(),
    }


def _build_serialization_context(
    complaints: list[Complaint], now: datetime
) -> SerializationContext:
    if not complaints:
        return SerializationContext(now=now)

    complaint_ids = [c.id for c in complaints]
    category_ids = {c.category_id for c in complaints if c.category_id}
    zone_ids = {c.zone_id for c in complaints if c.zone_id}

    categories = {}
    if category_ids:
        cats = db.session.execute(
            select(ComplaintCategory).where(ComplaintCategory.id.in_(category_ids))
        ).scalars()
        categories = {c.id: c for c in cats}

    zones = {}
    if zone_ids:
        zs = db.session.execute(select(Zone).where(Zone.id.in_(zone_ids))).scalars()
        zones = {z.id: z for z in zs}

    # Get first evidence for each
    first_evidence = {}
    evidences = db.session.execute(
        select(ComplaintEvidence).where(
            ComplaintEvidence.complaint_id.in_(complaint_ids), ComplaintEvidence.sequence == 1
        )
    ).scalars()
    for e in evidences:
        first_evidence[e.complaint_id] = e

    return SerializationContext(
        now=now,
        categories=categories,
        zones=zones,
        upvote_counts={},  # Stubs for now
        first_evidence=first_evidence,
    )


@bp.get("/officer/complaints")
@require_role(OFFICER)
def get_officer_queue():
    user = current_user()
    now = datetime.now(UTC).replace(tzinfo=None)

    query = scoping.visible_complaints(user)

    status_filter = request.args.getlist("status")
    if status_filter:
        valid_statuses = []
        for s in status_filter:
            with suppress(ValueError):
                valid_statuses.append(ComplaintStatus(s))
        if valid_statuses:
            query = query.where(Complaint.status.in_(valid_statuses))

    cat_id = request.args.get("categoryId")
    if cat_id:
        query = query.where(Complaint.category_id == cat_id)

    # Queue requires Critical severity and Overdue SLA first, then created_at DESC
    # For phase 4, we use created_at DESC as the primary sort until full sorting
    # capability is added in Phase 5. But let's add basic severity sorting
    from sqlalchemy import desc

    query = query.order_by(desc(Complaint.severity_score), desc(Complaint.created_at))

    # Pagination
    try:
        page = int(request.args.get("page", 1))
    except ValueError:
        page = 1
    if page < 1:
        page = 1

    try:
        page_size = int(request.args.get("pageSize", 20))
    except ValueError:
        page_size = 20
    if page_size < 1 or page_size > 100:
        page_size = 20

    # Total count for pagination
    from sqlalchemy import func

    total_items = db.session.execute(
        select(func.count()).select_from(query.subquery())
    ).scalar_one()

    query = query.offset((page - 1) * page_size).limit(page_size)
    complaints = db.session.execute(query).scalars().all()

    ctx = _build_serialization_context(complaints, now)

    # Fetch upvotes with GROUP BY
    from app.models import ComplaintUpvote

    if complaints:
        complaint_ids = [c.id for c in complaints]
        upvotes = db.session.execute(
            select(ComplaintUpvote.complaint_id, func.count())
            .where(ComplaintUpvote.complaint_id.in_(complaint_ids))
            .group_by(ComplaintUpvote.complaint_id)
        ).all()
        for cid, count in upvotes:
            ctx.upvote_counts[cid] = count

    data = [serialize_queue_item(c, ctx) for c in complaints]

    # Post-filtering for slaLabel and severityLabel (since they are derived labels)
    sla_label_filter = request.args.get("slaLabel")
    sev_label_filter = request.args.get("severityLabel")
    if sla_label_filter:
        data = [d for d in data if d.get("slaLabel") == sla_label_filter]
    if sev_label_filter:
        data = [d for d in data if d.get("severityLabel") == sev_label_filter]

    # If we post-filtered, we need to adjust totalItems correctly.
    # For Phase 4, filtering in python for derived properties is acceptable for the mock
    if sla_label_filter or sev_label_filter:
        total_items = len(data)

    total_pages = (total_items + page_size - 1) // page_size if total_items > 0 else 1

    return jsonify(
        {
            "data": data,
            "pagination": {
                "page": page,
                "pageSize": page_size,
                "totalItems": total_items,
                "totalPages": total_pages,
            },
        }
    )


@bp.post("/officer/complaints/<complaint_id>/claim")
@require_role(OFFICER)
def claim_complaint(complaint_id: str):
    user = current_user()
    now = datetime.now(UTC).replace(tzinfo=None)

    with transaction():
        complaint = lifecycle.claim(complaint_id=int(complaint_id), officer=user, now=now)

    ctx = _build_serialization_context([complaint], now)
    from app.api.shared.serializers import serialize_complaint_detail

    return jsonify(serialize_complaint_detail(complaint, ctx))


@bp.post("/officer/complaints/<complaint_id>/evidence-review")
@require_role(OFFICER)
@validate_body(EvidenceReviewRequest)
def review_evidence(complaint_id: str, body: EvidenceReviewRequest):
    user = current_user()
    now = datetime.now(UTC).replace(tzinfo=None)

    with transaction():
        complaint = lifecycle.review_evidence(
            complaint_id=int(complaint_id),
            officer=user,
            verdict=body.verdict,
            reason=body.reason,
            now=now,
        )

    ctx = _build_serialization_context([complaint], now)
    from app.api.shared.serializers import serialize_complaint_detail

    return jsonify(serialize_complaint_detail(complaint, ctx))


@bp.patch("/officer/complaints/<complaint_id>/status")
@require_role(OFFICER)
@validate_body(StatusUpdateRequest)
def update_complaint_status(complaint_id: str, body: StatusUpdateRequest):
    user = current_user()
    now = datetime.now(UTC).replace(tzinfo=None)

    with transaction():
        result = lifecycle.transition_by_officer(
            complaint_id=int(complaint_id),
            officer=user,
            target=body.status,
            reason=body.reason,
            note=body.note,
            now=now,
        )

    # We only serialize the result.complaint for context
    ctx = _build_serialization_context([result.complaint], now)
    return jsonify(serialize_status_update_result(result.complaint, result.cascade, ctx))


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
    now = datetime.now(UTC).replace(tzinfo=None)
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
    now = datetime.now(UTC).replace(tzinfo=None)

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
    now = datetime.now(UTC).replace(tzinfo=None)
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
    now = datetime.now(UTC).replace(tzinfo=None)
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
