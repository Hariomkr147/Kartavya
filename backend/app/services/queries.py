"""Shared filter / sort / paginate helpers, so every list endpoint behaves alike.

Four concerns nearly every list endpoint needs. Centralised here rather than
copied, because "sorting by severity" meaning two different things on two pages
is the kind of inconsistency nobody files a bug for and everybody notices.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, TypeVar

from sqlalchemy import DateTime, Float, Numeric, Select, case, cast, extract, func, literal, select
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.functions import FunctionElement

from app.domain.enums import ComplaintStatus, SeverityLabel, SlaLabel

T = TypeVar("T")


class seconds_between(FunctionElement):  # noqa: N801 - SQL constructs are lowercase
    """Wall-clock seconds from `start` to `end`, rounded to milliseconds.

    `seconds_between(end, start)`. There is no portable SQL for the difference
    between two timestamps, so each dialect gets its own rendering: SQLite has
    `julianday()` (days, as a float) and Postgres has `EXTRACT(EPOCH ...)`
    (seconds). Emitting either one directly is what broke the officer queue in
    production — `julianday` does not exist in Postgres, so every request that
    sorted by urgency or filtered by slaLabel answered 500.

    Rounding lives in here rather than at the call sites because it is a
    SQLite-specific correction that Postgres does not need: SQLite's raw
    julianday delta lands just under an exact boundary for some timestamps (100h
    can come back as 99.999999996h), which puts a complaint on the wrong side of
    an integer-second SLA threshold and makes SQL filtering disagree with
    `domain.sla.label()`. Both dialects round so the two agree with each other
    as well as with the domain.
    """

    inherit_cache = True
    type = Float()
    name = "seconds_between"


@compiles(seconds_between)
def _seconds_between_unsupported(element, compiler, **kw):
    raise NotImplementedError(
        f"seconds_between() has no rendering for the {compiler.dialect.name!r} dialect. "
        "Add one here rather than emitting dialect-specific SQL at the call site."
    )


@compiles(seconds_between, "sqlite")
def _seconds_between_sqlite(element, compiler, **kw):
    end, start = list(element.clauses)
    days = func.julianday(end) - func.julianday(start)
    return compiler.process(func.round(days * 86400.0, 3), **kw)


@compiles(seconds_between, "postgresql")
def _seconds_between_postgresql(element, compiler, **kw):
    end, start = list(element.clauses)
    # `round(double precision, int)` does not exist in Postgres — only
    # `round(numeric, int)` — so the cast is load-bearing, not decorative.
    seconds = cast(extract("epoch", end - start), Numeric)
    return compiler.process(cast(func.round(seconds, 3), Float), **kw)


#: openapi.yaml: Sort. A leading '-' means descending.
SORTABLE_FIELDS = ("createdAt", "updatedAt", "severity", "sla", "upvotes")

#: The officer queue's documented default order — "most urgent first (Critical
#: severity and Overdue SLA at the top)". Not a client-supplied sort key: it is
#: composite, so it cannot be expressed in the contract's single-field `sort`
#: grammar. Pass it as `apply_sort(..., default=URGENCY)` so an unrecognised
#: client sort still falls back to the documented order rather than erroring.
URGENCY = "__urgency__"


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


def sla_ratio_expression(now: datetime | None = None):
    """Fraction of a complaint's SLA target consumed, computed in SQL.

    The same arithmetic as `domain.sla.percent_consumed`, expressed so the
    database can ORDER BY it — sorting a page in Python would only order that
    page. Complaints with no clock yet sort as 0 (never accepted, so never
    overdue) rather than NULL, which the two engines order differently: SQLite
    puts NULLs first ascending, Postgres puts them last.
    """
    from app.models import Complaint

    # Bound as a timestamp, not an ISO string: Postgres cannot subtract text.
    ref_time = literal(now if now is not None else datetime.now(), DateTime)
    ongoing_pause = case(
        (
            Complaint.sla_paused_at.isnot(None),
            seconds_between(ref_time, Complaint.sla_paused_at),
        ),
        else_=0.0,
    )
    total_paused = Complaint.sla_paused_seconds + ongoing_pause
    elapsed_secs = seconds_between(ref_time, Complaint.sla_started_at) - total_paused
    target_secs = Complaint.sla_target_hours * 3600.0
    return case(
        (
            Complaint.sla_started_at.isnot(None) & (Complaint.sla_target_hours > 0),
            elapsed_secs / target_secs,
        ),
        else_=0.0,
    )


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

    if field_name not in SORTABLE_FIELDS and field_name != URGENCY:
        key = default
        descending = key.startswith("-")
        field_name = key.lstrip("-")

    if field_name == URGENCY:
        # "Most urgent first": worst severity, then worst SLA, then oldest-filed
        # as a stable final key so pagination never interleaves rows.
        return query.order_by(
            Complaint.severity_score.desc(),
            sla_ratio_expression(now).desc(),
            Complaint.created_at.desc(),
            Complaint.id.desc(),
        )

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
        sla_ratio = sla_ratio_expression(now)
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
        ref_time = literal(now, DateTime)
        wall_seconds = seconds_between(ref_time, Complaint.sla_started_at)
        open_pause = case(
            (
                Complaint.sla_paused_at.isnot(None),
                seconds_between(ref_time, Complaint.sla_paused_at),
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
