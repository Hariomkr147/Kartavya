"""The badge award engine's I/O half. The rules half is `domain/badges.py`."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select

from app.domain.badges import BadgeCriteria, CitizenStats, is_earned
from app.domain.enums import ComplaintStatus, UserRole
from app.extensions import db
from app.models import Badge, CitizenBadge, Complaint, PointsLedger, User


def gather_stats(*, citizen_id: int) -> CitizenStats:
    """Collect everything the criteria can ask about, in as few queries as possible.

    Needs: complaints filed, complaints closed, lifetime points,
    whether this citizen is #1 on their zone's leaderboard, and the `closed_at`
    of every complaint they have closed.
    """
    citizen = db.session.get(User, citizen_id)
    complaints_filed = db.session.execute(
        select(func.count(Complaint.id)).where(Complaint.citizen_id == citizen_id)
    ).scalar_one()
    closed_at_timestamps = list(
        db.session.execute(
            select(Complaint.closed_at).where(
                Complaint.citizen_id == citizen_id,
                Complaint.status == ComplaintStatus.CLOSED,
                Complaint.closed_at.is_not(None),
            )
        ).scalars()
    )
    lifetime = db.session.execute(
        select(func.coalesce(func.sum(PointsLedger.points_change), 0)).where(
            PointsLedger.citizen_id == citizen_id
        )
    ).scalar_one()

    is_zone_rank_one = False
    if citizen is not None and citizen.zone_id is not None:
        ranked_ids = list(
            db.session.execute(
                select(User.id)
                .outerjoin(PointsLedger, PointsLedger.citizen_id == User.id)
                .where(
                    User.role == UserRole.CITIZEN,
                    User.zone_id == citizen.zone_id,
                    User.is_active.is_(True),
                )
                .group_by(User.id)
                .order_by(
                    func.coalesce(func.sum(PointsLedger.points_change), 0).desc(),
                    User.created_at.asc(),
                    User.id.asc(),
                )
                .limit(1)
            ).scalars()
        )
        is_zone_rank_one = bool(ranked_ids and ranked_ids[0] == citizen_id)

    return CitizenStats(
        complaints_filed=int(complaints_filed),
        complaints_closed=len(closed_at_timestamps),
        lifetime_points=int(lifetime),
        is_zone_rank_one=is_zone_rank_one,
        closed_at_timestamps=closed_at_timestamps,
    )


def evaluate_and_award(*, citizen_id: int, now: datetime) -> list[CitizenBadge]:
    """Award every not-yet-earned badge whose criteria now hold.

    Load the `badges` rows, gather stats ONCE, and run
    `domain.badges.is_earned` per badge — the engine is data-driven, so adding a
    seventh badge is a seed change, not a code change.

    Check membership before inserting rather than relying on the
    (citizen_id, badge_id) unique index to raise: the index is the backstop, but
    a clean result beats catching an IntegrityError.

    Call after: complaint filed, complaint closed, points awarded, and any
    leaderboard-affecting change.
    """
    badges = list(db.session.execute(select(Badge)).scalars())
    earned_badge_ids = set(
        db.session.execute(
            select(CitizenBadge.badge_id).where(CitizenBadge.citizen_id == citizen_id)
        ).scalars()
    )
    stats = gather_stats(citizen_id=citizen_id)
    awards: list[CitizenBadge] = []
    for badge in badges:
        if badge.id in earned_badge_ids:
            continue
        criteria = BadgeCriteria(
            criteria_type=badge.criteria_type,
            criteria_value=badge.criteria_value,
            criteria_count=badge.criteria_count,
        )
        if not is_earned(criteria, stats):
            continue
        award = CitizenBadge(citizen_id=citizen_id, badge_id=badge.id, earned_at=now)
        db.session.add(award)
        awards.append(award)
    return awards
