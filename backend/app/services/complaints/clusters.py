"""Cluster linking, recomputation, the resolution cascade, and the reward guard.

Reference implementation: `frontend/src/mocks/lib/cluster.ts`, and the rules in
`docs/backend/complaints/CLUSTERED_COMPLAINT_LIFECYCLE.MD`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import update, select, func

from app.extensions import db
from app.models import Complaint, ComplaintCluster, ComplaintUpvote
from app.domain import geo, severity
from app.domain.enums import ComplaintStatus, StatusActor, PointsReason
from app.domain.errors import ConflictError
from app.domain.lifecycle import CASCADE_ELIGIBLE
from app.services.complaints import lifecycle


def link_new_complaint(*, complaint: Complaint, radius_meters: float, now: datetime) -> None:
    """Attach a freshly created complaint to a cluster, if there is one within radius."""
    # Find same-category, same-zone, non-rejected complaints within radius
    candidates = db.session.execute(
        select(Complaint)
        .where(
            Complaint.category_id == complaint.category_id,
            Complaint.zone_id == complaint.zone_id,
            Complaint.id != complaint.id,
            Complaint.status != ComplaintStatus.REJECTED,
        )
    ).scalars().all()
    
    # Filter by radius
    nearby = [
        c for c in candidates
        if geo.within_radius(
            float(complaint.latitude), float(complaint.longitude),
            float(c.latitude), float(c.longitude),
            radius_meters
        )
    ]
    if not nearby:
        return
    
    # Separate into cluster members and standalone complaints
    cluster_ids = {c.cluster_id for c in nearby if c.cluster_id is not None}
    standalone = [c for c in nearby if c.cluster_id is None]
    
    chosen_cluster_id = None
    
    # Prefer existing clusters
    if cluster_ids:
        # Find the cluster whose centroid is nearest AND within radius
        clusters = db.session.execute(
            select(ComplaintCluster).where(ComplaintCluster.id.in_(cluster_ids))
        ).scalars().all()
        
        nearest = None
        nearest_dist = float('inf')
        for cl in clusters:
            dist = geo.haversine_meters(
                float(complaint.latitude), float(complaint.longitude),
                float(cl.centroid_lat), float(cl.centroid_lng)
            )
            if dist < nearest_dist and dist <= radius_meters:
                nearest_dist = dist
                nearest = cl
        
        if nearest is not None:
            chosen_cluster_id = nearest.id
            complaint.cluster_id = chosen_cluster_id
    
    # No nearby cluster found — try to form a new one with a standalone
    if chosen_cluster_id is None and standalone:
        nearest = min(
            standalone,
            key=lambda c: geo.haversine_meters(
                float(complaint.latitude), float(complaint.longitude),
                float(c.latitude), float(c.longitude)
            )
        )
        # Create new cluster
        new_cluster = ComplaintCluster(
            category_id=complaint.category_id,
            zone_id=complaint.zone_id,
            centroid_lat=float(complaint.latitude),
            centroid_lng=float(complaint.longitude),
            report_count=2,
            unique_reporter_count=2,
            reward_granted=False,
            created_at=now,
            updated_at=now,
        )
        db.session.add(new_cluster)
        db.session.flush()
        
        complaint.cluster_id = new_cluster.id
        nearest.cluster_id = new_cluster.id
        chosen_cluster_id = new_cluster.id
    
    if chosen_cluster_id:
        recompute_cluster_aggregates(cluster_id=chosen_cluster_id, now=now)
        # recompute_severity_for_cluster is called by recompute_cluster_aggregates for all members


def recompute_cluster_aggregates(*, cluster_id: int, now: datetime) -> None:
    """Recompute centroid, report_count and unique_reporter_count from members."""
    cluster = db.session.get(ComplaintCluster, cluster_id)
    if not cluster:
        return
        
    members = db.session.execute(
        select(Complaint).where(Complaint.cluster_id == cluster_id)
    ).scalars().all()
    
    if not members:
        return
        
    cluster.report_count = len(members)
    unique_citizens = {m.citizen_id for m in members}
    cluster.unique_reporter_count = len(unique_citizens)
    
    c_lat, c_lng = geo.centroid([(float(m.latitude), float(m.longitude)) for m in members])
    cluster.centroid_lat = c_lat
    cluster.centroid_lng = c_lng
    cluster.updated_at = now
    
    # Batch recompute severity for all members
    unique_count = cluster.unique_reporter_count
    for member in members:
        upvotes = db.session.execute(
            select(func.count(ComplaintUpvote.id))
            .where(ComplaintUpvote.complaint_id == member.id)
        ).scalar() or 0
        member.severity_score = severity.score(unique_count, upvotes)


def recompute_severity_for_cluster(*, cluster_id: int | None, complaint_id: int) -> None:
    """Refresh `complaints.severity_score` for a complaint or a whole cluster."""
    complaint = db.session.get(Complaint, complaint_id)
    if not complaint:
        return
        
    unique_reporter_count = 1
    if cluster_id:
        cluster = db.session.get(ComplaintCluster, cluster_id)
        if cluster:
            unique_reporter_count = cluster.unique_reporter_count
            
    upvotes = db.session.execute(
        select(func.count(ComplaintUpvote.id))
        .where(ComplaintUpvote.complaint_id == complaint_id)
    ).scalar() or 0
    
    complaint.severity_score = severity.score(unique_reporter_count, upvotes)


def claim_cluster_reward(*, cluster_id: int) -> bool:
    """Atomic test-and-set: did THIS confirm win the one-time +50?

    The highest-stakes race in the system — getting it wrong pays +50 twice.
    The test-and-set IS the decision, and it must happen in the same transaction
    as the CLOSED write.
    """
    return (
        db.session.execute(
            update(ComplaintCluster)
            .where(
                ComplaintCluster.id == cluster_id,
                ComplaintCluster.reward_granted.is_(False),
            )
            .values(reward_granted=True)
            .execution_options(synchronize_session="fetch")
        ).rowcount
        == 1
    )


def citizen_already_rewarded_in_cluster(*, cluster_id: int, citizen_id: int) -> bool:
    """Has this citizen already been paid a cluster reward in this cluster?
    
    Cluster rewards are paid at most once per citizen per cluster.
    Check for COMPLAINT_CLOSED or CLUSTER_MEMBER_CLOSED on any complaint
    belonging to this citizen AND this cluster.
    """
    from sqlalchemy import exists
    from app.models import PointsLedger
    return db.session.execute(
        select(
            exists().where(
                PointsLedger.citizen_id == citizen_id,
                PointsLedger.reason.in_([
                    PointsReason.COMPLAINT_CLOSED,
                    PointsReason.CLUSTER_MEMBER_CLOSED,
                ]),
                PointsLedger.complaint_id.in_(
                    select(Complaint.id).where(Complaint.cluster_id == cluster_id)
                ),
            )
        )
    ).scalar() or False


def cascade_resolution(*, resolved: Complaint, now: datetime) -> list[dict[str, Any]]:
    """Sweep the rest of the cluster to RESOLVED when the shared issue is fixed."""
    if not resolved.cluster_id:
        return []
    
    cluster_members = db.session.execute(
        select(Complaint)
        .where(
            Complaint.cluster_id == resolved.cluster_id,
            Complaint.id != resolved.id,
        )
    ).scalars().all()
    
    results = []
    for member in cluster_members:
        if member.status in CASCADE_ELIGIBLE:
            try:
                lifecycle.apply_transition(
                    complaint_id=member.id,
                    expected_status=member.status,
                    new_status=ComplaintStatus.RESOLVED,
                    actor_role=StatusActor.SYSTEM,
                    changed_by_user_id=None,
                    now=now,
                    extra_values={"resolved_at": now},
                )
                results.append({"complaintId": str(member.id), "outcome": "CASCADED", "previousStatus": member.status.value})
            except ConflictError:
                # Race: another thread moved it between SELECT and UPDATE
                results.append({"complaintId": str(member.id), "outcome": "SKIPPED", "previousStatus": member.status.value})
        else:
            results.append({"complaintId": str(member.id), "outcome": "SKIPPED", "previousStatus": member.status.value})
    
    return results
