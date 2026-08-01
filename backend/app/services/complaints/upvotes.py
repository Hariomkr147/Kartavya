"""Upvotes - one per citizen per complaint, never on your own."""

from __future__ import annotations

from datetime import datetime
from sqlalchemy import select, func

from app.models import User, Complaint, ComplaintUpvote
from app.domain.enums import PointsReason
from app.domain.errors import ConflictError, ValidationError
from app.extensions import db

def upvote(*, complaint_id: int, citizen: User, now: datetime) -> dict[str, int]:
    """POST /complaints/{id}/upvote -> UpvoteResult {upvoteCount, severityScore}."""
    complaint = db.session.get(Complaint, complaint_id)
    if not complaint:
        raise ValidationError("Complaint not found")
        
    if complaint.citizen_id == citizen.id:
        raise ConflictError("SELF_UPVOTE", "You cannot upvote your own complaint.")

    # Check for existing upvote
    existing = db.session.scalar(
        select(ComplaintUpvote.id).where(
            ComplaintUpvote.complaint_id == complaint_id,
            ComplaintUpvote.citizen_id == citizen.id
        )
    )
    if existing:
        raise ConflictError("ALREADY_UPVOTED", "You have already upvoted this complaint.")

    # Insert upvote
    new_upvote = ComplaintUpvote(
        complaint_id=complaint_id,
        citizen_id=citizen.id,
        created_at=now
    )
    db.session.add(new_upvote)
    db.session.flush()

    # Reward the reporter
    from app.services.gamification.ledger import award
    award(citizen_id=complaint.citizen_id, complaint_id=complaint_id, reason=PointsReason.UPVOTE_RECEIVED, now=now)

    # Recompute severity for the cluster
    from app.services.complaints.clusters import recompute_severity_for_cluster
    recompute_severity_for_cluster(cluster_id=complaint.cluster_id or complaint.id, is_standalone=complaint.cluster_id is None)
    
    db.session.flush()

    # Fetch new values
    upvote_cnt = db.session.scalar(
        select(func.count(ComplaintUpvote.id)).where(ComplaintUpvote.complaint_id == complaint_id)
    ) or 0

    return {
        "upvoteCount": upvote_cnt,
        "severityScore": complaint.severity_score
    }

def upvote_counts(*, complaint_ids: list[int]) -> dict[int, int]:
    if not complaint_ids:
        return {}
    stmt = select(ComplaintUpvote.complaint_id, func.count(ComplaintUpvote.id)).where(ComplaintUpvote.complaint_id.in_(complaint_ids)).group_by(ComplaintUpvote.complaint_id)
    return dict(db.session.execute(stmt).all())
