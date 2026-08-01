"""Endpoints available to more than one audience.

Clusters and zone summaries are officer + admin. The photo route is authorized
by its URL signature rather than by a header, which is a different mechanism
from everything else in the system — see `core/signing.py`.
"""

from __future__ import annotations

from flask import Blueprint, request, jsonify
from datetime import datetime, timezone
from sqlalchemy import select, func, desc

from app.api.shared.responses import todo
from app.core.auth import require_role, current_user
from app.core import scoping
from app.domain.enums import UserRole, ComplaintStatus
from app.models import ComplaintCluster, Complaint
from app.extensions import db
from app.api.shared.serializers import SerializationContext, serialize_cluster, serialize_cluster_detail

bp = Blueprint("shared", __name__)

OFFICER = UserRole.OFFICER
ADMIN = UserRole.ADMIN


@bp.get("/clusters")
@require_role(OFFICER, ADMIN)
def get_clusters():
    user = current_user()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
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
        
    # Get all clusters visible to this user
    # A cluster is visible if it has at least one complaint in the user's zone
    visible_complaints = scoping.visible_complaints(user).subquery()
    
    cluster_ids_query = select(visible_complaints.c.cluster_id).where(visible_complaints.c.cluster_id.is_not(None)).distinct()
    
    query = select(ComplaintCluster).where(ComplaintCluster.id.in_(cluster_ids_query)).order_by(desc(ComplaintCluster.created_at))
    
    # Pagination
    total_items = db.session.execute(select(func.count()).select_from(cluster_ids_query.subquery())).scalar_one()
    query = query.offset((page - 1) * page_size).limit(page_size)
    clusters = db.session.execute(query).scalars().all()
    
    # Build context
    ctx = SerializationContext(now=now)
    if clusters:
        cluster_ids = [c.id for c in clusters]
        members = db.session.execute(
            select(Complaint).where(Complaint.cluster_id.in_(cluster_ids))
        ).scalars().all()
        for m in members:
            ctx.cluster_members.setdefault(m.cluster_id, []).append(m)
            
        # Also need categories and zones
        from app.models import ComplaintCategory, Zone
        cat_ids = {m.category_id for m in members}
        zone_ids = {m.zone_id for m in members}
        
        cats = db.session.execute(select(ComplaintCategory).where(ComplaintCategory.id.in_(cat_ids))).scalars().all()
        ctx.categories = {c.id: c for c in cats}
        
        zones = db.session.execute(select(Zone).where(Zone.id.in_(zone_ids))).scalars().all()
        ctx.zones = {z.id: z for z in zones}
        
        # Upvotes
        from app.models import ComplaintUpvote
        upvotes = dict(
            db.session.execute(
                select(ComplaintUpvote.complaint_id, func.count(ComplaintUpvote.id))
                .where(ComplaintUpvote.complaint_id.in_([m.id for m in members]))
                .group_by(ComplaintUpvote.complaint_id)
            ).all()
        )
        ctx.upvote_counts = upvotes
        
    data = [serialize_cluster(c, ctx) for c in clusters]
    total_pages = (total_items + page_size - 1) // page_size if total_items > 0 else 1
    
    return jsonify({
        "data": data,
        "pagination": {
            "page": page,
            "pageSize": page_size,
            "totalItems": total_items,
            "totalPages": total_pages,
            "hasNext": page < total_pages,
        }
    })


@bp.get("/clusters/<cluster_id>")
@require_role(OFFICER, ADMIN)
def get_cluster_by_id(cluster_id: str):
    user = current_user()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    cluster = db.session.get(ComplaintCluster, int(cluster_id))
    if not cluster:
        from app.domain.errors import NotFoundError
        raise NotFoundError("Cluster not found")
        
    members = db.session.execute(
        scoping.visible_complaints(user).where(Complaint.cluster_id == int(cluster_id))
    ).scalars().all()
    
    if not members:
        from app.domain.errors import NotFoundError
        raise NotFoundError("Cluster not found or not visible to you")
        
    ctx = SerializationContext(now=now)
    ctx.cluster_members[cluster.id] = list(members)
    
    from app.models import ComplaintCategory, Zone
    cat_ids = {m.category_id for m in members}
    zone_ids = {m.zone_id for m in members}
    
    cats = db.session.execute(select(ComplaintCategory).where(ComplaintCategory.id.in_(cat_ids))).scalars().all()
    ctx.categories = {c.id: c for c in cats}
    
    zones = db.session.execute(select(Zone).where(Zone.id.in_(zone_ids))).scalars().all()
    ctx.zones = {z.id: z for z in zones}
    
    from app.models import ComplaintUpvote
    upvotes = dict(
        db.session.execute(
            select(ComplaintUpvote.complaint_id, func.count(ComplaintUpvote.id))
            .where(ComplaintUpvote.complaint_id.in_([m.id for m in members]))
            .group_by(ComplaintUpvote.complaint_id)
        ).all()
    )
    ctx.upvote_counts = upvotes
    
    return jsonify(serialize_cluster_detail(cluster, ctx))


@bp.get("/zones/<zone_id>/summary")
@require_role(OFFICER, ADMIN)
def get_zone_summary(zone_id: str):
    user = current_user()
    
    scoping.assert_can_view_zone(user, int(zone_id))
    
    total = db.session.execute(
        select(func.count(Complaint.id)).where(Complaint.zone_id == int(zone_id))
    ).scalar_one()
    
    resolved = db.session.execute(
        select(func.count(Complaint.id)).where(
            Complaint.zone_id == int(zone_id),
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
            Complaint.zone_id == int(zone_id),
            Complaint.status.in_(active_statuses)
        )
    ).scalar_one()
    
    return jsonify({
        "zoneId": zone_id,
        "totalComplaints": total,
        "activeComplaints": active,
        "resolvedComplaints": resolved,
    })


@bp.get("/evidence/<int:evidence_id>/photo")
def get_evidence_photo(evidence_id: int):
    """200 image/jpeg|png. PUBLIC (`security: []`) — authorized by signature.

    TODO(phase 3). This route is deliberately unusual, and the three rules are
    the whole design:

      1. It verifies the SIGNATURE AND NOTHING ELSE. No JWT, no session, no zone
         lookup — the check already happened when a serializer decided this
         caller could see the parent complaint and minted the link. A browser
         `<img>` tag cannot carry a bearer token; the signature carries that
         earlier verdict instead.
      2. It answers 403 for a bad signature AND for a missing evidence row
         ALIKE. A 404 would let anyone enumerate which evidence IDs exist.
      3. Set `Cache-Control: private, max-age=<remaining TTL>` from
         `verify_photo_signature`'s return value, so the browser caches the
         image exactly as long as the link is valid and no shared proxy caches
         it at all.

    Serve with `send_file` from UPLOAD_DIR, which sits outside the web root and
    is never registered as a static directory.
    """
    _exp = request.args.get("exp")
    _sig = request.args.get("sig")
    
    from app.core.signing import verify_photo_signature
    remaining_ttl = verify_photo_signature(evidence_id, _exp, _sig)
    
    from app.models import ComplaintEvidence
    evidence = db.session.get(ComplaintEvidence, evidence_id)
    if not evidence:
        from app.domain.errors import ForbiddenError
        # Same error as a bad signature to avoid enumerating IDs
        raise ForbiddenError("This photo link is not valid.")
        
    from flask import current_app, send_file
    from app.infra.storage import open_photo
    try:
        photo_path = open_photo(file_path=evidence.file_path, upload_dir=current_app.config["UPLOAD_DIR"])
        response = send_file(photo_path)
        response.headers["Cache-Control"] = f"private, max-age={remaining_ttl}"
        return response
    except Exception:
        from app.domain.errors import ForbiddenError
        raise ForbiddenError("This photo link is not valid.")
