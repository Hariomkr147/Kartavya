"""Preloaded read models for cross-zone admin complaint views."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select

from app.domain.enums import ComplaintStatus, SlaLabel
from app.domain.errors import NotFoundError
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
from app.services.queries import Pagination, apply_filters, apply_pagination, apply_sort


@dataclass
class AdminComplaintPage:
    complaints: list[Complaint]
    data: AdminComplaintData
    pagination: Pagination


@dataclass
class AdminComplaintData:
    now: datetime
    categories: dict[int, ComplaintCategory]
    zones: dict[int, Zone]
    users: dict[int, User]
    upvote_counts: dict[int, int]
    first_evidence: dict[int, ComplaintEvidence]
    evidence_rows: dict[int, list[ComplaintEvidence]]
    history_rows: dict[int, list[StatusHistory]]
    note_rows: dict[int, list[ComplaintNote]]


def _data(rows: list[Complaint], *, now: datetime, details: bool) -> AdminComplaintData:
    data = AdminComplaintData(now, {}, {}, {}, {}, {}, {}, {}, {})
    if not rows:
        return data
    complaint_ids = [row.id for row in rows]
    data.categories = {
        row.id: row
        for row in db.session.scalars(
            select(ComplaintCategory).where(
                ComplaintCategory.id.in_({row.category_id for row in rows})
            )
        )
    }
    data.zones = {
        row.id: row
        for row in db.session.scalars(
            select(Zone).where(Zone.id.in_({row.zone_id for row in rows}))
        )
    }
    data.users = {
        row.id: row
        for row in db.session.scalars(
            select(User).where(User.id.in_({row.citizen_id for row in rows}))
        )
    }
    data.upvote_counts = {
        complaint_id: int(count)
        for complaint_id, count in db.session.execute(
            select(ComplaintUpvote.complaint_id, func.count(ComplaintUpvote.id))
            .where(ComplaintUpvote.complaint_id.in_(complaint_ids))
            .group_by(ComplaintUpvote.complaint_id)
        )
    }
    evidence = list(
        db.session.scalars(
            select(ComplaintEvidence)
            .where(ComplaintEvidence.complaint_id.in_(complaint_ids))
            .order_by(ComplaintEvidence.complaint_id, ComplaintEvidence.sequence)
        )
    )
    for row in evidence:
        data.first_evidence.setdefault(row.complaint_id, row)
        if details:
            data.evidence_rows.setdefault(row.complaint_id, []).append(row)
    if details:
        for row in db.session.scalars(
            select(StatusHistory)
            .where(StatusHistory.complaint_id.in_(complaint_ids))
            .order_by(StatusHistory.complaint_id, StatusHistory.created_at, StatusHistory.id)
        ):
            data.history_rows.setdefault(row.complaint_id, []).append(row)
        for row in db.session.scalars(
            select(ComplaintNote)
            .where(ComplaintNote.complaint_id.in_(complaint_ids))
            .order_by(ComplaintNote.complaint_id, ComplaintNote.created_at, ComplaintNote.id)
        ):
            data.note_rows.setdefault(row.complaint_id, []).append(row)
    return data


def list_admin_complaints(
    *,
    zone_id: int | None,
    category_id: int | None,
    statuses: list[ComplaintStatus] | None,
    sla_label: SlaLabel | None,
    date_from: datetime | None,
    date_to: datetime | None,
    sort: str | None,
    page: int,
    page_size: int,
    now: datetime,
) -> AdminComplaintPage:
    query = apply_filters(
        select(Complaint),
        zone_id=zone_id,
        category_id=category_id,
        statuses=statuses,
        sla_label=sla_label,
        date_from=date_from,
        date_to=date_to,
        now=now,
    )
    total = db.session.execute(
        select(func.count()).select_from(query.order_by(None).subquery())
    ).scalar_one()
    rows = list(
        db.session.scalars(
            apply_pagination(apply_sort(query, sort, "-createdAt", now=now), page, page_size)
        )
    )
    return AdminComplaintPage(
        complaints=rows,
        data=_data(rows, now=now, details=False),
        pagination=Pagination(page=page, page_size=page_size, total_items=int(total)),
    )


def load_admin_complaint(
    *, complaint_id: int, now: datetime
) -> tuple[Complaint, AdminComplaintData]:
    complaint = db.session.get(Complaint, complaint_id)
    if complaint is None:
        raise NotFoundError("No such complaint.")
    return complaint, _data([complaint], now=now, details=True)
