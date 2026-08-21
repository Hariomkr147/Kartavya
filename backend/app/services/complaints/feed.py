from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select

from app.core.context import SerializationContext
from app.domain.enums import ComplaintStatus
from app.domain.errors import ForbiddenError
from app.extensions import db
from app.models.accounts import User
from app.models.complaints import Complaint
from app.models.history import ComplaintUpvote
from app.services.complaints.reads import build_serialization_context
from app.services.queries import (
    Pagination,
    apply_filters,
    apply_pagination,
    apply_sort,
    clamp_page_args,
)

TERMINAL_STATUSES = {
    ComplaintStatus.REJECTED,
    ComplaintStatus.CLOSED,
}


def get_public_feed(
    *,
    citizen: User,
    query_params: Any,
    now: datetime,
) -> tuple[list[Complaint], Pagination, SerializationContext, set[int]]:
    """Fetch paginated, anonymized complaints for a citizen's home zone feed."""
    target_zone_id = query_params.zoneId
    if target_zone_id is not None and int(target_zone_id) != citizen.zone_id:
        raise ForbiddenError("Citizens may only request their own zone.")

    stmt = select(Complaint).where(Complaint.zone_id == citizen.zone_id)

    category_id = query_params.categoryId
    sort_val = query_params.sort or "-createdAt"

    stmt = apply_filters(stmt, category_id=category_id)

    if not query_params.includeResolved:
        stmt = stmt.where(Complaint.status.not_in(TERMINAL_STATUSES))

    page, page_size = clamp_page_args(
        query_params.page,
        query_params.pageSize,
        max_page_size=100,
    )

    count_stmt = select(db.func.count()).select_from(stmt.subquery())
    total_items = db.session.scalar(count_stmt) or 0

    sorted_query = apply_sort(stmt, sort=sort_val, default="-createdAt", now=now)
    paginated_query = apply_pagination(sorted_query, page=page, page_size=page_size)

    complaints = list(db.session.scalars(paginated_query).all())
    ctx = build_serialization_context(complaints, now)
    pagination = Pagination(page=page, page_size=page_size, total_items=total_items)

    comp_ids = [c.id for c in complaints]
    citizen_upvoted_ids = set()
    if comp_ids:
        up_stmt = select(ComplaintUpvote.complaint_id).where(
            ComplaintUpvote.complaint_id.in_(comp_ids),
            ComplaintUpvote.citizen_id == citizen.id,
        )
        citizen_upvoted_ids = set(db.session.scalars(up_stmt).all())

    return complaints, pagination, ctx, citizen_upvoted_ids
