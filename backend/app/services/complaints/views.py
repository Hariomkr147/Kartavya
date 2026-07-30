"""Preloaded complaint data used by audience serializers."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import object_session

from app.domain.errors import NotFoundError
from app.extensions import db
from app.models import (
    Complaint,
    ComplaintCategory,
    ComplaintEvidence,
    ComplaintNote,
    ComplaintUpvote,
    StatusHistory,
    Zone,
)


@dataclass
class ComplaintDetailData:
    complaint: Complaint
    category: ComplaintCategory
    zone: Zone
    upvote_count: int
    evidence: list[ComplaintEvidence]
    history: list[StatusHistory]
    notes: list[ComplaintNote]


def load_complaint_detail(*, complaint_id: int) -> ComplaintDetailData:
    """Load everything a ComplaintDetail serializer needs without serializer queries."""
    # Everything the caller has written so far must be on the wire before this
    # runs. Two reasons: the reads below have to see the new status_history and
    # evidence rows, and the expunge at the bottom would otherwise be capable of
    # dropping a still-pending INSERT out of the session entirely. Autoflush
    # would cover both today, but only by accident of statement ordering.
    db.session.flush()
    complaint = db.session.get(Complaint, complaint_id)
    if complaint is None:
        raise NotFoundError("No such complaint.")
    category = db.session.get(ComplaintCategory, complaint.category_id)
    zone = db.session.get(Zone, complaint.zone_id)
    if category is None or zone is None:
        raise NotFoundError("Complaint reference data is missing.")

    evidence = list(
        db.session.execute(
            select(ComplaintEvidence)
            .where(ComplaintEvidence.complaint_id == complaint_id)
            .order_by(ComplaintEvidence.sequence)
        )
        .scalars()
        .all()
    )
    history = list(
        db.session.execute(
            select(StatusHistory)
            .where(StatusHistory.complaint_id == complaint_id)
            .order_by(StatusHistory.created_at, StatusHistory.id)
        )
        .scalars()
        .all()
    )
    notes = list(
        db.session.execute(
            select(ComplaintNote)
            .where(ComplaintNote.complaint_id == complaint_id)
            .order_by(ComplaintNote.created_at, ComplaintNote.id)
        )
        .scalars()
        .all()
    )
    upvote_count = db.session.execute(
        select(func.count(ComplaintUpvote.id)).where(ComplaintUpvote.complaint_id == complaint_id)
    ).scalar_one()
    detail = ComplaintDetailData(
        complaint=complaint,
        category=category,
        zone=zone,
        upvote_count=int(upvote_count),
        evidence=evidence,
        history=history,
        notes=notes,
    )
    # The action service commits after this loader returns. SQLAlchemy expires
    # attached instances on commit, which would make the serializer issue lazy
    # queries. Detach this fully-loaded response snapshot before that commit.
    instances = [complaint, category, zone, *evidence, *history, *notes]
    session = db.session()
    for instance in instances:
        if object_session(instance) is session:
            session.expunge(instance)
    return detail
