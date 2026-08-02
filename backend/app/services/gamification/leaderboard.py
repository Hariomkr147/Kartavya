"""Leaderboard query service for gamification."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select

from app.domain.enums import UserRole
from app.extensions import db
from app.models.accounts import User
from app.models.gamification import PointsLedger
from app.services.queries import Pagination, clamp_page_args


@dataclass(frozen=True)
class LeaderboardEntry:
    rank: int
    citizen_id: str
    handle: str
    points: int
    is_top_three: bool
    is_current_user: bool

    def to_dict(self) -> dict:
        return {
            "rank": self.rank,
            "citizenId": str(self.citizen_id),
            "displayName": self.handle,
            "points": self.points,
            "isTopThree": self.is_top_three,
            "isCurrentUser": self.is_current_user,
        }


def zone_rank(*, citizen_id: int) -> int | None:
    """This citizen's position within their own zone."""
    citizen = db.session.get(User, citizen_id)
    if not citizen or citizen.zone_id is None:
        return None
    from datetime import datetime, UTC
    _, entries, _ = get_leaderboard_service(caller=citizen, scope='zone', period='all_time', page=1, page_size=1000, now=datetime.now(UTC))
    for e in entries:
        if e['citizenId'] == str(citizen_id):
            return e['rank']
    return None

def get_leaderboard_service(
    *,
    caller: User,
    scope: str,
    period: str,
    page: int | None,
    page_size: int | None,
    now: datetime,
) -> tuple[dict | None, list[dict], Pagination]:
    """Fetch sequential, ranked leaderboard entries for active citizens using SQL ordering."""
    page_num, size = clamp_page_args(page, page_size, max_page_size=100)

    # 1. Target citizens query (scoped by zone if requested)
    user_stmt = select(User.id).where(
        User.role == UserRole.CITIZEN,
        User.is_active.is_(True),
    )
    if scope == "zone":
        user_stmt = user_stmt.where(User.zone_id == caller.zone_id)

    # 2. Points aggregation subquery scoped to target citizens (P6-3)
    pts_stmt = select(
        PointsLedger.citizen_id,
        func.coalesce(func.sum(PointsLedger.points_change), 0).label("pts"),
    ).where(PointsLedger.citizen_id.in_(user_stmt))

    if period == "monthly":
        first_day_of_month = datetime(now.year, now.month, 1, tzinfo=UTC)
        pts_stmt = pts_stmt.where(PointsLedger.created_at >= first_day_of_month)

    pts_sub = pts_stmt.group_by(PointsLedger.citizen_id).subquery()

    # 3. Join User with aggregated points, ordered by points DESC, created_at ASC, id ASC (P6-1)
    pts_col = func.coalesce(pts_sub.c.pts, 0)
    query = (
        select(User, pts_col.label("total_points"))
        .outerjoin(pts_sub, User.id == pts_sub.c.citizen_id)
        .where(User.role == UserRole.CITIZEN, User.is_active.is_(True))
    )
    if scope == "zone":
        query = query.where(User.zone_id == caller.zone_id)

    query = query.order_by(
        pts_col.desc(),
        User.created_at.asc(),
        User.id.asc(),
    )

    rows = db.session.execute(query).all()
    total_items = len(rows)

    all_entries: list[LeaderboardEntry] = []
    current_user_entry: dict | None = None

    for rank, (citizen, points) in enumerate(rows, start=1):
        handle = citizen.display_name or f"Citizen #{citizen.id}"
        is_current_user = citizen.id == caller.id
        entry = LeaderboardEntry(
            rank=rank,
            citizen_id=str(citizen.id),
            handle=handle,
            points=int(points),
            is_top_three=rank <= 3,
            is_current_user=is_current_user,
        )
        all_entries.append(entry)
        if is_current_user:
            current_user_entry = entry.to_dict()

    start_idx = (page_num - 1) * size
    end_idx = start_idx + size
    page_entries = all_entries[start_idx:end_idx]

    pagination = Pagination(
        page=page_num,
        page_size=size,
        total_items=total_items,
    )

    return current_user_entry, [e.to_dict() for e in page_entries], pagination
