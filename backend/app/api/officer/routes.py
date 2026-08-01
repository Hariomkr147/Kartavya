"""Officer endpoints — zone-scoped, and identity-free.

The single most important property of this package: NOTHING here emits reporter
identity. Not the queue, not the detail view, not the cascade result. The
compact `Complaint` shape has no reporter field at all, which is why there is
nothing to strip.

A cheap, high-value test for every route in this file:
`assert "reporter" not in response.get_json()`.
"""

from __future__ import annotations

from flask import Blueprint, request, jsonify
from datetime import datetime, timezone
from sqlalchemy import select, func, desc

from app.api.shared.responses import todo
from app.api.shared.serializers import SerializationContext
from app.api.officer.schemas import EvidenceReviewRequest, StatusUpdateRequest, ProgressNoteRequest, BatchStatusUpdateRequest
from app.api.officer.serializers import serialize_queue_item, serialize_status_update_result
from app.core.auth import require_auth, require_role, current_user
from app.core.session import transaction
from app.core.validation import validate_body
from app.domain.enums import UserRole, ComplaintStatus, EvidenceVerdict, OfficerTargetStatus
from app.services.complaints import lifecycle
from app.services.analytics import officer as analytics_officer
from app.models import Complaint, ComplaintEvidence, ComplaintCategory, Zone
from app.core import scoping
from app.extensions import db

bp = Blueprint("officer", __name__)

OFFICER = UserRole.OFFICER

def _build_serialization_context(complaints: list[Complaint], now: datetime) -> SerializationContext:
    if not complaints:
        return SerializationContext(now=now)

    complaint_ids = [c.id for c in complaints]
    category_ids = {c.category_id for c in complaints if c.category_id}
    zone_ids = {c.zone_id for c in complaints if c.zone_id}
    
    categories = {}
    if category_ids:
        cats = db.session.execute(select(ComplaintCategory).where(ComplaintCategory.id.in_(category_ids))).scalars()
        categories = {c.id: c for c in cats}
        
    zones = {}
    if zone_ids:
        zs = db.session.execute(select(Zone).where(Zone.id.in_(zone_ids))).scalars()
        zones = {z.id: z for z in zs}
        
    # Get first evidence for each
    first_evidence = {}
    evidences = db.session.execute(
        select(ComplaintEvidence)
        .where(ComplaintEvidence.complaint_id.in_(complaint_ids), ComplaintEvidence.sequence == 1)
    ).scalars()
    for e in evidences:
        first_evidence[e.complaint_id] = e
        
    return SerializationContext(
        now=now,
        categories=categories,
        zones=zones,
        upvote_counts={}, # Stubs for now
        first_evidence=first_evidence
    )

@bp.get("/officer/complaints")
@require_role(OFFICER)
def get_officer_queue():
    user = current_user()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    query = scoping.visible_complaints(user)
    
    status_filter = request.args.getlist("status")
    if status_filter:
        valid_statuses = []
        for s in status_filter:
            try:
                valid_statuses.append(ComplaintStatus(s))
            except ValueError:
                pass
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
    
    return jsonify({
        "data": data,
        "pagination": {
            "page": page,
            "pageSize": page_size,
            "totalItems": total_items,
            "totalPages": total_pages
        }
    })



@bp.post("/officer/complaints/<complaint_id>/claim")
@require_role(OFFICER)
def claim_complaint(complaint_id: str):
    user = current_user()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    with transaction():
        complaint = lifecycle.claim(
            complaint_id=int(complaint_id),
            officer=user,
            now=now
        )
        
    ctx = _build_serialization_context([complaint], now)
    from app.api.shared.serializers import serialize_complaint_detail
    return jsonify(serialize_complaint_detail(complaint, ctx))


@bp.post("/officer/complaints/<complaint_id>/evidence-review")
@require_role(OFFICER)
@validate_body(EvidenceReviewRequest)
def review_evidence(complaint_id: str, body: EvidenceReviewRequest):
    user = current_user()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    with transaction():
        complaint = lifecycle.review_evidence(
            complaint_id=int(complaint_id),
            officer=user,
            verdict=body.verdict,
            reason=body.reason,
            now=now
        )
        
    ctx = _build_serialization_context([complaint], now)
    from app.api.shared.serializers import serialize_complaint_detail
    return jsonify(serialize_complaint_detail(complaint, ctx))


@bp.patch("/officer/complaints/<complaint_id>/status")
@require_role(OFFICER)
@validate_body(StatusUpdateRequest)
def update_complaint_status(complaint_id: str, body: StatusUpdateRequest):
    user = current_user()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    with transaction():
        result = lifecycle.transition_by_officer(
            complaint_id=int(complaint_id),
            officer=user,
            target=body.status,
            reason=body.reason,
            note=body.note,
            now=now
        )
        
    # We only serialize the result.complaint for context
    ctx = _build_serialization_context([result.complaint], now)
    return jsonify(serialize_status_update_result(result.complaint, result.cascade, ctx))


@bp.post("/officer/complaints/batch-status")
@require_role(OFFICER)
@validate_body(BatchStatusUpdateRequest)
def batch_update_status(body: BatchStatusUpdateRequest):
    user = current_user()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    with transaction():
        c_ids = None
        if body.complaintIds:
            c_ids = [int(c) for c in body.complaintIds]
            
        cluster_id = None
        if body.clusterId:
            cluster_id = int(body.clusterId)
            
        res = lifecycle.transition_batch(
            officer=user,
            complaint_ids=c_ids,
            cluster_id=cluster_id,
            target=body.status,
            reason=body.reason,
            note=body.note,
            now=now
        )
        
    return jsonify(res)


@bp.post("/officer/complaints/<complaint_id>/notes")
@require_role(OFFICER)
@validate_body(ProgressNoteRequest)
def add_progress_note(complaint_id: str, body: ProgressNoteRequest):
    user = current_user()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    with transaction():
        note = lifecycle.add_progress_note(
            complaint_id=int(complaint_id),
            officer=user,
            note_text=body.text,
            now=now
        )
        
    return jsonify({
        "id": str(note.id),
        "officerId": str(note.officer_id),
        "text": note.note_text,
        "createdAt": note.created_at.isoformat()
    }), 201


@bp.post("/officer/clusters/<cluster_id>/notes")
@require_role(OFFICER)
@validate_body(ProgressNoteRequest)
def add_cluster_progress_note(cluster_id: str, body: ProgressNoteRequest):
    user = current_user()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    with transaction():
        # First ensure cluster exists and officer has access to it via a member
        from app.models import ComplaintCluster
        cluster = db.session.get(ComplaintCluster, int(cluster_id))
        if not cluster:
            from app.domain.errors import NotFoundError
            raise NotFoundError("Cluster not found")
            
        members = db.session.execute(
            scoping.visible_complaints(user).where(Complaint.cluster_id == int(cluster_id))
        ).scalars().all()
        
        if not members:
            from app.domain.errors import NotFoundError
            raise NotFoundError("Cluster not found or not in your zone")
            
        # Filter eligible members: IN_PROGRESS or UNDER_RESOLUTION
        eligible = [m for m in members if m.status in (ComplaintStatus.IN_PROGRESS, ComplaintStatus.UNDER_RESOLUTION)]
        if not eligible:
            from app.domain.errors import ConflictError
            raise ConflictError("INVALID_STATUS", "Notes can only be added to complaints in progress or under resolution.")
            
        notes_created = []
        for m in eligible:
            note = lifecycle.add_progress_note(
                complaint_id=m.id,
                officer=user,
                note_text=body.text,
                now=now
            )
            notes_created.append(note)
            
    notes_json = []
    for n in notes_created:
        notes_json.append({
            "id": str(n.id),
            "officerId": str(n.officer_id),
            "text": n.note_text,
            "createdAt": n.created_at.isoformat()
        })
        
    return jsonify(notes_json), 201


@bp.get("/officer/analytics")
@require_role(OFFICER)
def get_officer_analytics():
    """200 ZoneAnalytics — for THIS officer's zone only."""
    user = current_user()
    
    total = db.session.execute(
        select(func.count(Complaint.id)).where(Complaint.zone_id == user.zone_id)
    ).scalar_one()
    
    resolved = db.session.execute(
        select(func.count(Complaint.id)).where(
            Complaint.zone_id == user.zone_id,
            Complaint.status == ComplaintStatus.RESOLVED
        )
    ).scalar_one()
    
    active_statuses = {
        ComplaintStatus.SUBMITTED,
        ComplaintStatus.EVIDENCE_UNDER_REVIEW,
        ComplaintStatus.NEEDS_MORE_EVIDENCE,
        ComplaintStatus.UNDER_REVIEW,
        ComplaintStatus.IN_PROGRESS,
        ComplaintStatus.UNDER_RESOLUTION,
        ComplaintStatus.REOPENED,
    }
    
    active = db.session.execute(
        select(func.count(Complaint.id)).where(
            Complaint.zone_id == user.zone_id,
            Complaint.status.in_(active_statuses)
        )
    ).scalar_one()
    
    # Calculate avgResolutionHoursThisMonth
    resolved_complaints = db.session.execute(
        select(Complaint).where(
            Complaint.zone_id == user.zone_id,
            Complaint.status == ComplaintStatus.RESOLVED
        )
    ).scalars().all()
    
    total_hours = 0.0
    valid_count = 0
    for rc in resolved_complaints:
        if rc.resolved_at and rc.sla_started_at:
            delta = rc.resolved_at - rc.sla_started_at
            hours = delta.total_seconds() / 3600.0
            if rc.sla_paused_seconds:
                hours -= (rc.sla_paused_seconds / 3600.0)
            
            if hours > 0:
                total_hours += hours
                valid_count += 1
                
    avg_res = round(total_hours / valid_count, 1) if valid_count > 0 else 0.0
    
    # Calculate overdueCount and categoryBreakdown
    active_complaints_list = db.session.execute(
        select(Complaint).where(
            Complaint.zone_id == user.zone_id,
            Complaint.status.in_(active_statuses)
        )
    ).scalars().all()
    
    overdue_count = 0
    cat_breakdown = {}
    from app.domain.sla import status as sla_status
    for c in active_complaints_list:
        if c.sla_target_hours and c.sla_started_at:
            if sla_status(now=datetime.now(timezone.utc).replace(tzinfo=None), sla_started_at=c.sla_started_at, sla_target_hours=c.sla_target_hours, sla_paused_seconds=c.sla_paused_seconds).name == "OVERDUE":
                overdue_count += 1
        
        cat_id = str(c.category_id)
        cat_breakdown[cat_id] = cat_breakdown.get(cat_id, 0) + 1
        
    zone = db.session.get(Zone, user.zone_id)
    zone_name = zone.name if zone else "Unknown Zone"
    
    return jsonify({
        "zoneId": str(user.zone_id),
        "zoneName": zone_name,
        "activeComplaints": active,
        "overdueCount": overdue_count,
        "avgResolutionHoursThisMonth": avg_res,
        "categoryBreakdown": cat_breakdown
    })


@bp.get("/officers/<officer_id>/stats")
@require_auth
def get_public_officer_stats(officer_id: str):
    stats = analytics_officer.public_officer_stats(officer_id=int(officer_id))
    return jsonify(stats)
