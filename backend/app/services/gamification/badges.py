"""The badge award engine's I/O half. The rules half is domain/badges.py."""

from __future__ import annotations

from datetime import datetime
from sqlalchemy import select, func

from app.domain.badges import CitizenStats, is_earned, BadgeCriteria
from app.extensions import db
from app.models.accounts import User
from app.models.complaints import Complaint
from app.models.gamification import Badge, CitizenBadge, PointsLedger
from app.models.history import StatusHistory
from app.domain.enums import ComplaintStatus

def gather_stats(*, citizen_id: int) -> CitizenStats:
    """Collect everything the criteria can ask about, in as few queries as possible."""
    # Complaints filed
    filed_cnt = db.session.scalar(
        select(func.count(Complaint.id)).where(Complaint.citizen_id == citizen_id)
    ) or 0
    
    # Complaints closed
    closed_cnt = db.session.scalar(
        select(func.count(Complaint.id)).where(
            Complaint.citizen_id == citizen_id,
            Complaint.status == ComplaintStatus.CLOSED
        )
    ) or 0

    # Lifetime points
    pts = db.session.scalar(
        select(func.sum(PointsLedger.points_change)).where(
            PointsLedger.citizen_id == citizen_id
        )
    ) or 0

    # Zone rank 1
    # We can use the leaderboard service, or replicate the logic since it's just for this user
    from app.services.gamification.leaderboard import zone_rank
    is_rank_one = zone_rank(citizen_id=citizen_id) == 1

    # Closed at timestamps
    closed_at_list = list(db.session.scalars(
        select(StatusHistory.created_at)
        .join(Complaint, Complaint.id == StatusHistory.complaint_id)
        .where(
            Complaint.citizen_id == citizen_id,
            StatusHistory.to_status == ComplaintStatus.CLOSED
        )
    ).all())

    return CitizenStats(
        complaints_filed=filed_cnt,
        complaints_closed=closed_cnt,
        lifetime_points=pts,
        is_zone_rank_one=is_rank_one,
        closed_at_timestamps=closed_at_list,
    )

def evaluate_and_award(*, citizen_id: int, now: datetime) -> list[CitizenBadge]:
    """Award every not-yet-earned badge whose criteria now hold."""
    # Load all badges
    all_badges = list(db.session.scalars(select(Badge)).all())
    if not all_badges:
        return []

    # Get already earned
    earned_ids = set(db.session.scalars(
        select(CitizenBadge.badge_id)
        .where(CitizenBadge.citizen_id == citizen_id)
    ).all())

    unearned_badges = [b for b in all_badges if b.id not in earned_ids]
    if not unearned_badges:
        return []

    stats = gather_stats(citizen_id=citizen_id)
    newly_awarded = []

    for badge in unearned_badges:
        criteria = BadgeCriteria(
            criteria_type=badge.criteria_type,
            criteria_value=badge.criteria_value,
            criteria_count=badge.criteria_count,
        )
        if is_earned(criteria, stats):
            cb = CitizenBadge(
                citizen_id=citizen_id,
                badge_id=badge.id,
                awarded_at=now
            )
            db.session.add(cb)
            newly_awarded.append(cb)
            
    return newly_awarded
