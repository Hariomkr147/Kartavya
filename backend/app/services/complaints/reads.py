"""Read-side complaint queries for list and detail views.

Separated from submission.py (write-side) per docs/backend/architecture.md §3.1.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select

from app.core.context import SerializationContext
from app.core.scoping import visible_complaints
from app.domain.errors import ForbiddenError, NotFoundError
from app.extensions import db
from app.models import (
    Complaint,
    ComplaintCategory,
    ComplaintEvidence,
    ComplaintNote,
    ComplaintUpvote,
    StatusHistory,
    User,
    Zone,
)
from app.services.queries import (
    URGENCY,
    Pagination,
    apply_filters,
    apply_pagination,
    apply_sort,
    clamp_page_args,
)


@dataclass(frozen=True)
class ComplaintDetailResult:
    complaint: Complaint
    ctx: SerializationContext
    evidence: list[ComplaintEvidence]
    history: list[StatusHistory]
    notes: list[Any]
    reporter: User | None


def get_citizen_complaints(
    *,
    citizen: User,
    query_params: Any,
    now: datetime,
) -> tuple[list[Complaint], Pagination, SerializationContext]:
    """Service to fetch paginated complaints for a citizen with pre-loaded context."""
    page, page_size = clamp_page_args(
        query_params.page,
        query_params.pageSize,
        max_page_size=100,
    )

    raw_query = visible_complaints(citizen)

    statuses = query_params.status
    if statuses and not isinstance(statuses, list):
        statuses = [statuses]

    category_id = query_params.categoryId
    sort_val = query_params.sort or "-createdAt"

    filtered_query = apply_filters(
        raw_query,
        statuses=statuses,
        category_id=category_id,
    )

    count_stmt = select(db.func.count()).select_from(filtered_query.subquery())
    total_items = db.session.scalar(count_stmt) or 0

    sorted_query = apply_sort(filtered_query, sort=sort_val, default="-createdAt", now=now)
    paginated_query = apply_pagination(sorted_query, page=page, page_size=page_size)

    complaints = list(db.session.scalars(paginated_query).all())

    ctx = build_serialization_context(complaints, now)
    pagination = Pagination(page=page, page_size=page_size, total_items=total_items)
    return complaints, pagination, ctx


def get_officer_queue(
    *,
    officer: User,
    query_params: Any,
    now: datetime,
) -> tuple[list[Complaint], Pagination, SerializationContext]:
    """GET /officer/complaints — the zone queue, filtered and sorted in SQL.

    Every filter, including the two DERIVED labels, is applied as part of the
    query rather than to the page after it. That distinction is the whole point:
    post-filtering a page searches only the rows that page happened to contain
    and reports a total that describes the filtered page, not the result set —
    so `severityLabel=CRITICAL` on a busy zone would silently return whichever
    critical complaints landed on page 1 and claim that was all of them.

    `severityLabel` becomes a range check on the cached `severity_score`;
    `slaLabel` becomes the elapsed-time expression in `queries.apply_filters`.
    Both live in `services/queries.py` so the officer queue, the admin list and
    the CSV export cannot disagree about what OVERDUE means.
    """
    page, page_size = clamp_page_args(query_params.page, query_params.pageSize, max_page_size=100)

    statuses = query_params.status
    if statuses and not isinstance(statuses, list):
        statuses = [statuses]

    query = apply_filters(
        visible_complaints(officer),
        statuses=statuses,
        category_id=query_params.categoryId,
        sla_label=query_params.slaLabel,
        severity_label=query_params.severityLabel,
        now=now,
    )

    total_items = db.session.scalar(select(db.func.count()).select_from(query.subquery())) or 0

    rows = list(
        db.session.scalars(
            apply_pagination(
                apply_sort(query, query_params.sort, default=URGENCY, now=now),
                page=page,
                page_size=page_size,
            )
        ).all()
    )

    return rows, Pagination(page=page, page_size=page_size, total_items=total_items), (
        build_serialization_context(rows, now)
    )


def build_serialization_context(complaints: list[Complaint], now: datetime) -> SerializationContext:
    """Build pre-fetched SerializationContext for a list of complaints."""
    categories = {c.id: c for c in db.session.scalars(select(ComplaintCategory)).all()}
    zones = {z.id: z for z in db.session.scalars(select(Zone)).all()}

    comp_ids = [c.id for c in complaints]
    first_evidence_map = {}
    if comp_ids:
        sub = (
            select(
                ComplaintEvidence.complaint_id,
                db.func.min(ComplaintEvidence.sequence).label("min_seq"),
            )
            .where(ComplaintEvidence.complaint_id.in_(comp_ids))
            .group_by(ComplaintEvidence.complaint_id)
            .subquery()
        )
        ev_stmt = select(ComplaintEvidence).join(
            sub,
            (ComplaintEvidence.complaint_id == sub.c.complaint_id)
            & (ComplaintEvidence.sequence == sub.c.min_seq),
        )
        for ev in db.session.scalars(ev_stmt).all():
            first_evidence_map[ev.complaint_id] = ev

    upvote_counts_map = {}
    if comp_ids:
        up_stmt = (
            select(
                ComplaintUpvote.complaint_id,
                db.func.count(ComplaintUpvote.id).label("cnt"),
            )
            .where(ComplaintUpvote.complaint_id.in_(comp_ids))
            .group_by(ComplaintUpvote.complaint_id)
        )
        for comp_id, cnt in db.session.execute(up_stmt):
            upvote_counts_map[comp_id] = cnt

    return SerializationContext(
        now=now,
        categories=categories,
        zones=zones,
        upvote_counts=upvote_counts_map,
        first_evidence=first_evidence_map,
    )


def get_complaint_detail(
    *,
    user: User,
    complaint_id: int,
    now: datetime,
) -> ComplaintDetailResult:
    """Read a single complaint with scoping, history, and evidence pre-loaded.

    Uses visible_complaints(user) as the single source of truth for scoping per §7.3.
    """
    stmt = visible_complaints(user).where(Complaint.id == complaint_id)
    complaint = db.session.scalar(stmt)
    if complaint is None:
        raw_exists = db.session.get(Complaint, complaint_id)
        if raw_exists is not None:
            raise ForbiddenError("You do not have access to this complaint.")
        raise NotFoundError("No such complaint.")

    cat = db.session.get(ComplaintCategory, complaint.category_id)
    zone = db.session.get(Zone, complaint.zone_id)

    categories = {cat.id: cat} if cat else {}
    zones = {zone.id: zone} if zone else {}

    evidence_records = list(
        db.session.scalars(
            select(ComplaintEvidence)
            .where(ComplaintEvidence.complaint_id == complaint.id)
            .order_by(ComplaintEvidence.sequence.asc())
        ).all()
    )

    history_records = list(
        db.session.scalars(
            select(StatusHistory)
            .where(StatusHistory.complaint_id == complaint.id)
            .order_by(StatusHistory.created_at.asc())
        ).all()
    )

    notes_records = list(
        db.session.scalars(
            select(ComplaintNote)
            .where(ComplaintNote.complaint_id == complaint.id)
            .order_by(ComplaintNote.created_at.asc())
        ).all()
    )

    upvote_cnt = (
        db.session.scalar(
            select(db.func.count(ComplaintUpvote.id)).where(
                ComplaintUpvote.complaint_id == complaint.id
            )
        )
        or 0
    )

    first_ev = evidence_records[0] if evidence_records else None

    ctx = SerializationContext(
        now=now,
        categories=categories,
        zones=zones,
        upvote_counts={complaint.id: upvote_cnt},
        first_evidence={complaint.id: first_ev} if first_ev else {},
    )

    reporter_user = None
    if user.role.value == "ADMIN":
        reporter_user = db.session.get(User, complaint.citizen_id)

    return ComplaintDetailResult(
        complaint=complaint,
        ctx=ctx,
        evidence=evidence_records,
        history=history_records,
        notes=notes_records,
        reporter=reporter_user,
    )
