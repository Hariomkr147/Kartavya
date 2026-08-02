"""Shared filter / sort / paginate helpers, so every list endpoint behaves alike.

Four concerns nearly every list endpoint needs. Centralised here rather than
copied, because "sorting by severity" meaning two different things on two pages
is the kind of inconsistency nobody files a bug for and everybody notices.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, TypeVar

from sqlalchemy import Select, case, func, select

from app.domain.enums import ComplaintStatus, SeverityLabel, SlaLabel

T = TypeVar("T")

#: openapi.yaml: Sort. A leading '-' means descending.
SORTABLE_FIELDS = ("createdAt", "updatedAt", "severity", "sla", "upvotes")


@dataclass(frozen=True)
class Pagination:
    """The PaginationMeta envelope every list response is wrapped in."""

    page: int
    page_size: int
    total_items: int

    @property
    def total_pages(self) -> int:
        if self.page_size <= 0:
            return 0
        return (self.total_items + self.page_size - 1) // self.page_size

    def to_dict(self) -> dict[str, int]:
        return {
            "page": self.page,
            "pageSize": self.page_size,
            "totalItems": self.total_items,
            "totalPages": self.total_pages,
        }


def clamp_page_args(page: int | None, page_size: int | None, max_page_size: int) -> tuple[int, int]:
    """1-based page (default 1), page size default 20, capped at 100."""
    resolved_page = max(1, page or 1)
    resolved_size = min(max(1, page_size or 20), max_page_size)
    return resolved_page, resolved_size


def apply_pagination(query: Select[Any], page: int, page_size: int) -> Select[Any]:
    return query.limit(page_size).offset((page - 1) * page_size)


def apply_sort(
    query: Select[Any], sort: str | None, default: str, now: datetime | None = None
) -> Select[Any]:
    """Apply a `field` / `-field` sort for openapi.yaml: SORTABLE_FIELDS.

    An UNRECOGNISED value falls back to the endpoint's documented default.
    """
    from app.models import Complaint, ComplaintUpvote

    key = sort if sort else default
    descending = key.startswith("-")
    field_name = key.lstrip("-")

    if field_name not in SORTABLE_FIELDS:
        key = default
        descending = key.startswith("-")
        field_name = key.lstrip("-")

    if field_name == "createdAt":
        col = Complaint.created_at
        return query.order_by(col.desc() if descending else col.asc())

    if field_name == "updatedAt":
        col = Complaint.updated_at
        return query.order_by(col.desc() if descending else col.asc())

    if field_name == "severity":
        col = Complaint.severity_score
        return query.order_by(col.desc() if descending else col.asc())

    if field_name == "upvotes":
        upvote_sub = (
            select(ComplaintUpvote.complaint_id, func.count(ComplaintUpvote.id).label("cnt"))
            .group_by(ComplaintUpvote.complaint_id)
            .subquery()
        )
        query = query.outerjoin(upvote_sub, Complaint.id == upvote_sub.c.complaint_id)
        upvote_cnt = func.coalesce(upvote_sub.c.cnt, 0)
        return query.order_by(upvote_cnt.desc() if descending else upvote_cnt.asc())

    if field_name == "sla":
        ref_time = now if now is not None else datetime.now()
        now_jd = func.julianday(ref_time.isoformat())
        paused_jd = func.julianday(Complaint.sla_paused_at)
        started_jd = func.julianday(Complaint.sla_started_at)
        ongoing_pause = case(
            (Complaint.sla_paused_at.isnot(None), (now_jd - paused_jd) * 86400.0),
            else_=0.0,
        )
        total_paused = Complaint.sla_paused_seconds + ongoing_pause
        elapsed_secs = (now_jd - started_jd) * 86400.0 - total_paused
        target_secs = Complaint.sla_target_hours * 3600.0
        sla_ratio = case(
            (
                Complaint.sla_started_at.isnot(None) & (Complaint.sla_target_hours > 0),
                elapsed_secs / target_secs,
            ),
            else_=0.0,
        )
        return query.order_by(sla_ratio.desc() if descending else sla_ratio.asc())

    return query


def apply_filters(
    query: Select[Any],
    *,
    statuses: list[ComplaintStatus] | None = None,
    category_id: int | None = None,
    zone_id: int | None = None,
    sla_label: SlaLabel | None = None,
    severity_label: SeverityLabel | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    now: datetime | None = None,
) -> Select[Any]:
    """Apply the contract's standard filter set.

    slaLabel -> needs the elapsed-time expression computed in SQL, or a post-filter applied
    to the page. DECIDE ONCE, HERE, and write down which you chose.
    """
    from app.domain import severity as severity_domain
    from app.models import Complaint

    if sla_label is not None:
        if now is None:
            raise ValueError("now is required when filtering by slaLabel")
        now_jd = func.julianday(now.isoformat())
        started_jd = func.julianday(Complaint.sla_started_at)
        paused_jd = func.julianday(Complaint.sla_paused_at)
        # SQLite's raw julianday delta is slightly below an exact boundary for
        # some timestamps (for example 100 h can become 99.999999996 h). Round
        # wall-clock spans to milliseconds before applying the integer-second
        # SLA thresholds so SQL filtering agrees with domain.sla.label().
        wall_seconds = func.round((now_jd - started_jd) * 86400.0, 3)
        open_pause = case(
            (
                Complaint.sla_paused_at.isnot(None),
                func.round((now_jd - paused_jd) * 86400.0, 3),
            ),
            else_=0.0,
        )
        elapsed = wall_seconds - Complaint.sla_paused_seconds - open_pause
        delayed_at = Complaint.sla_target_hours * 2880
        overdue_at = Complaint.sla_target_hours * 3600
        has_clock = (
            Complaint.sla_started_at.isnot(None)
            & Complaint.sla_target_hours.isnot(None)
            & (Complaint.sla_target_hours > 0)
        )
        if sla_label is SlaLabel.ON_TIME:
            query = query.where(has_clock, elapsed < delayed_at)
        elif sla_label is SlaLabel.DELAYED:
            query = query.where(has_clock, elapsed >= delayed_at, elapsed < overdue_at)
        else:
            query = query.where(has_clock, elapsed >= overdue_at)

    if statuses:
        clean_statuses = [s for s in statuses if s]
        if clean_statuses:
            query = query.where(Complaint.status.in_(clean_statuses))

    if category_id is not None:
        query = query.where(Complaint.category_id == category_id)

    if zone_id is not None:
        query = query.where(Complaint.zone_id == zone_id)

    if date_from is not None:
        query = query.where(Complaint.created_at >= date_from)

    if date_to is not None:
        query = query.where(Complaint.created_at <= date_to)

    if severity_label is not None:
        floor, ceil = severity_domain.score_range(severity_label)
        if ceil is None:
            query = query.where(Complaint.severity_score >= floor)
        else:
            query = query.where(Complaint.severity_score.between(floor, ceil))

    return query
