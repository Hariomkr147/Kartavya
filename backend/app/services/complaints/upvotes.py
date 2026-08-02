"""Upvotes — one per citizen per complaint, never on your own.

An upvote has two effects: +1 to the complaint's severity score, and +5 CSP to
the REPORTER (not the voter).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.session import transaction
from app.domain.enums import ComplaintStatus, PointsReason
from app.domain.errors import ConflictError, ForbiddenError, NotFoundError
from app.domain.severity import label
from app.extensions import db
from app.models import Complaint, ComplaintUpvote, User
from app.services.complaints.clusters import recompute_severity_for_cluster
from app.services.gamification.ledger import award


def upvote(*, complaint_id: int, citizen: User, now: datetime) -> dict[str, object]:
    """POST /complaints/{id}/upvote -> UpvoteResult {complaintId, upvoteCount, severityLabel}.

    One transaction:
      1. 409 ALREADY_UPVOTED if this citizen already upvoted it. Check first
         rather than catching the unique-index IntegrityError, so the response
         is a clean contract error rather than a 500.
      2. 409 (or 400) if `citizen.id == complaint.citizen_id` — no self-upvotes.
      3. Insert the `complaint_upvotes` row.
      4. Credit UPVOTE_RECEIVED (+5) to the complaint's REPORTER.
      5. `clusters.recompute_severity_for_cluster(...)` — an upvote changes only
         this complaint's own score, but the cluster's API-level severity is
         computed from the members' totals, so recompute through the same path.
      6. Re-evaluate the reporter's badges.

    Returns the new count and score for the response body.
    """
    with transaction():
        complaint = db.session.get(Complaint, complaint_id)
        if complaint is None:
            raise NotFoundError("No such complaint.")
        if complaint.citizen_id == citizen.id:
            raise ForbiddenError("You cannot upvote your own complaint.")
        if complaint.zone_id != citizen.zone_id:
            raise ForbiddenError("You cannot upvote a complaint outside your zone.")
        if complaint.status is ComplaintStatus.CLOSED:
            # ALREADY_CLOSED, not COMPLAINT_CLOSED — the latter is a
            # PointsReason value, and an error code that collides with a points
            # reason is a trap for anyone reading logs.
            raise ConflictError(
                "ALREADY_CLOSED",
                "This complaint is already closed.",
            )
        existing = db.session.execute(
            select(ComplaintUpvote.id).where(
                ComplaintUpvote.complaint_id == complaint.id,
                ComplaintUpvote.citizen_id == citizen.id,
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise ConflictError(
                "ALREADY_UPVOTED",
                "You have already upvoted this complaint.",
            )

        db.session.add(
            ComplaintUpvote(
                complaint_id=complaint.id,
                citizen_id=citizen.id,
                created_at=now,
            )
        )
        try:
            db.session.flush()
        except IntegrityError as exc:
            # The unique index is the concurrency backstop after the friendly
            # pre-check above. Only this flush is translated to ALREADY_UPVOTED.
            raise ConflictError(
                "ALREADY_UPVOTED",
                "You have already upvoted this complaint.",
            ) from exc
        award(
            citizen_id=complaint.citizen_id,
            complaint_id=complaint.id,
            reason=PointsReason.UPVOTE_RECEIVED,
            now=now,
        )
        recompute_severity_for_cluster(
            cluster_id=complaint.cluster_id,
            complaint_id=complaint.id,
        )
        db.session.flush()
        upvote_count = db.session.execute(
            select(func.count(ComplaintUpvote.id)).where(
                ComplaintUpvote.complaint_id == complaint.id
            )
        ).scalar_one()
        result = {
            "complaintId": str(complaint.id),
            "upvoteCount": int(upvote_count),
            "severityLabel": label(complaint.severity_score).value,
        }
    return result


def upvote_counts(*, complaint_ids: list[int]) -> dict[int, int]:
    """COUNT(*) per complaint, in ONE GROUP BY.

    TODO(phase 3). Serializers must not query, so list endpoints prefetch this
    and hand it to the serializer. Without it a 20-item page becomes 20 extra
    queries — and `GET /feed` and the officer queue serialize a full page on
    every call.
    """
    if not complaint_ids:
        return {}
    return {
        complaint_id: int(count)
        for complaint_id, count in db.session.execute(
            select(ComplaintUpvote.complaint_id, func.count(ComplaintUpvote.id))
            .where(ComplaintUpvote.complaint_id.in_(complaint_ids))
            .group_by(ComplaintUpvote.complaint_id)
        ).all()
    }
