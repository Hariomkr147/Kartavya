"""Shared filter / sort / paginate helpers, so every list endpoint behaves alike.

Four concerns nearly every list endpoint needs. Centralised here rather than
copied, because "sorting by severity" meaning two different things on two pages
is the kind of inconsistency nobody files a bug for and everybody notices.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, TypeVar

from sqlalchemy import Select

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


def apply_sort(query: Select[Any], sort: str | None, default: str) -> Select[Any]:
    """Apply a `field` / `-field` sort.

    TODO(phase 3). An UNRECOGNISED value falls back to the endpoint's documented
    default rather than erroring — a client experimenting with a sort key should
    get a sensible page, not a 400.

    Note `sla` is not a column. Sorting by it means sorting by the elapsed-time
    expression; see `apply_filters` for the same problem on the filter side.
    """
    raise NotImplementedError


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
    """Apply the contract's standard filter set. TODO(phase 3).

    Two of these are DERIVED values, so neither is a plain WHERE on a column:

      * `severityLabel` -> a range check on the cached `severity_score`. Use
        `domain.severity.score_range(label)` so the bands cannot drift apart
        from the ones the serializer uses.
      * `slaLabel` -> needs the elapsed-time expression computed in SQL, or a
        post-filter applied to the page. DECIDE ONCE, HERE, and write down which
        you chose — a post-filter makes `totalItems` a lie, and an SQL
        expression has to reproduce the pause arithmetic exactly.
    """
    raise NotImplementedError
