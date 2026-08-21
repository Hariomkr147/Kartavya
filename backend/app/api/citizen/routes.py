"""Citizen endpoints.

Privacy rules enforced at this layer:
  1. A citizen sees their OWN complaints in full.
  2. A citizen sees OTHER citizens' complaints (via feed or direct lookup)
     with identity fields structurally absent — not null, not masked, ABSENT.
  3. A citizen never sees officer names or internal notes.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from flask import Blueprint, jsonify, request

from app.api.citizen.schemas import (
    ComplaintListQuery,
    CreateComplaintForm,
    FeedQuery,
    LeaderboardQuery,
)
from app.api.citizen.serializers import serialize_own_complaint
from app.api.shared.context import detail_context
from app.core.auth import current_user, require_auth, require_role
from app.core.serialization import iso_utc as _iso
from app.core.validation import parse_model, validate_query
from app.domain.enums import UserRole
from app.domain.errors import NotFoundError, ValidationError
from app.services.complaints.lifecycle import (
    confirm_resolution as confirm_resolution_service,
)
from app.services.complaints.lifecycle import (
    dispute_resolution as dispute_resolution_service,
)
from app.services.complaints.reads import (
    get_citizen_complaints,
    get_complaint_detail,
)
from app.services.complaints.submission import (
    create_complaint as create_complaint_service,
)
from app.services.complaints.submission import resubmit_evidence
from app.services.complaints.upvotes import upvote
from app.services.complaints.views import ComplaintDetailData

bp = Blueprint("citizen", __name__)

CITIZEN = UserRole.CITIZEN


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _parse_complaint_id(complaint_id: str) -> int:
    try:
        return int(complaint_id)
    except ValueError as exc:
        raise NotFoundError("No such complaint.") from exc


def _serialize_detail(detail: ComplaintDetailData, *, now: datetime) -> dict[str, object]:
    return serialize_own_complaint(
        detail.complaint,
        detail_context(detail, now=now),
        is_detail=True,
    )


# --- Complaints ---------------------------------------------------------------


@bp.post("/complaints")
@require_role(CITIZEN)
def create_complaint():
    """201 ComplaintDetail. multipart/form-data: 1-3 photos + fields."""
    raw_form: dict[str, Any] = {}
    for key in request.form:
        vals = request.form.getlist(key)
        raw_form[key] = vals if len(vals) > 1 else vals[0]

    form = parse_model(CreateComplaintForm, raw_form)

    allowed_file_keys = {"photos"}
    for file_key in request.files:
        if file_key not in allowed_file_keys:
            raise ValidationError(f"Unexpected file field: '{file_key}'. Only 'photos' is allowed.")

    photos = request.files.getlist("photos")

    now = datetime.now(UTC)
    res = create_complaint_service(
        citizen=current_user(),
        category_id=form.categoryId,
        zone_id=form.zoneId,
        latitude=form.latitude,
        longitude=form.longitude,
        description=form.description,
        category_suggested_by_matcher=form.categorySuggestedByMatcher,
        photos=photos,
        now=now,
    )

    payload = serialize_own_complaint(
        res.complaint,
        res.ctx,
        is_detail=True,
        evidence_list=res.evidence,
        history_list=res.history,
        notes_list=res.notes,
    )
    return jsonify(payload), 201


@bp.get("/complaints/my")
@require_role(CITIZEN)
@validate_query(ComplaintListQuery)
def get_my_complaints(query: ComplaintListQuery):
    """200 ComplaintListResponse — the citizen dashboard."""
    now = datetime.now(UTC)
    items, pagination, ctx = get_citizen_complaints(
        citizen=current_user(),
        query_params=query,
        now=now,
    )

    serialized_items = [serialize_own_complaint(c, ctx, is_detail=False) for c in items]
    return jsonify({"data": serialized_items, "pagination": pagination.to_dict()}), 200


@bp.get("/complaints/<complaint_id>")
@require_auth
def get_complaint_by_id(complaint_id: str):
    """200 ComplaintDetail. Any role — the RESPONSE SHAPE is what differs."""
    try:
        cid = int(complaint_id)
    except ValueError as err:
        raise NotFoundError("No such complaint.") from err

    user = current_user()
    now = datetime.now(UTC)

    detail = get_complaint_detail(
        user=user,
        complaint_id=cid,
        now=now,
    )

    if user.role == UserRole.CITIZEN:
        data = serialize_own_complaint(
            detail.complaint,
            detail.ctx,
            is_detail=True,
            evidence_list=detail.evidence,
            history_list=detail.history,
            notes_list=detail.notes,
        )
    elif user.role == UserRole.OFFICER:
        from app.api.officer.serializers import serialize_officer_complaint_detail

        data = serialize_officer_complaint_detail(
            detail.complaint,
            detail.ctx,
            evidence_list=detail.evidence,
            history_list=detail.history,
            notes_list=detail.notes,
        )
    else:  # ADMIN
        from app.api.admin.serializers import serialize_complaint_for_admin

        data = serialize_complaint_for_admin(
            detail.complaint,
            detail.ctx,
            evidence_list=detail.evidence,
            history_list=detail.history,
            notes_list=detail.notes,
            reporter_user=detail.reporter,
        )

    return jsonify(data), 200


@bp.post("/complaints/<complaint_id>/evidence")
@require_role(CITIZEN)
def submit_additional_evidence(complaint_id: str):
    """200 ComplaintDetail — answering a NEEDS_MORE_EVIDENCE request.

    Appends evidence at the next `sequence` (old rows kept) and
    moves the complaint back to EVIDENCE_UNDER_REVIEW, RESUMING the SLA clock if
    it had already started.
    """
    now = _utcnow()
    detail = resubmit_evidence(
        complaint_id=_parse_complaint_id(complaint_id),
        citizen=current_user(),
        photos=[request.files.get("photo")],
        now=now,
    )
    return jsonify(_serialize_detail(detail, now=now)), 201


@bp.post("/complaints/<complaint_id>/upvote")
@require_role(CITIZEN)
def upvote_complaint(complaint_id: str):
    """200 UpvoteResult {complaintId, upvoteCount, severityLabel}.

    409 ALREADY_UPVOTED on a repeat; no self-upvotes. Credits +5
    to the REPORTER, not the voter, and recomputes severity.
    """
    return jsonify(
        upvote(
            complaint_id=_parse_complaint_id(complaint_id),
            citizen=current_user(),
            now=_utcnow(),
        )
    )


@bp.post("/complaints/<complaint_id>/confirm")
@require_role(CITIZEN)
def confirm_resolution(complaint_id: str):
    """200 ComplaintDetail — RESOLVED -> CLOSED.

    The ONLY path that credits confirm rewards. Auto-close and an
    admin-rejected dispute both close a complaint with zero points.
    """
    now = _utcnow()
    detail = confirm_resolution_service(
        complaint_id=_parse_complaint_id(complaint_id),
        citizen=current_user(),
        now=now,
    )
    return jsonify(_serialize_detail(detail, now=now))


@bp.post("/complaints/<complaint_id>/dispute")
@require_role(CITIZEN)
def dispute_resolution(complaint_id: str):
    """200 ComplaintDetail — RESOLVED -> REOPENED. multipart: reason + a photo.

    Both are required — the citizen carries the burden of proof.
    An ADMIN then rules on it, never the officer who did the work.
    """
    now = _utcnow()
    detail = dispute_resolution_service(
        complaint_id=_parse_complaint_id(complaint_id),
        citizen=current_user(),
        reason=request.form.get("reason"),
        photo=request.files.get("photo"),
        now=now,
    )
    return jsonify(_serialize_detail(detail, now=now))


# --- Feed ---------------------------------------------------------------------


@bp.get("/feed")
@require_role(CITIZEN)
@validate_query(FeedQuery)
def get_feed_route(query: FeedQuery):
    """200 FeedListResponse — the anonymized zone feed.

    A citizen sees complaints in their home zone only (403 for any other
    zone). Closed and rejected complaints are hidden unless `includeResolved`.
    The `reporter` object is STRUCTURALLY ABSENT from every item.
    """
    from app.api.citizen.serializers import serialize_feed_item
    from app.services.complaints.feed import get_public_feed

    now = datetime.now(UTC)
    items, pagination, ctx, upvoted_ids = get_public_feed(
        citizen=current_user(), query_params=query, now=now
    )
    return jsonify(
        {
            "data": [
                serialize_feed_item(item, ctx, citizen_upvoted_ids=upvoted_ids) for item in items
            ],
            "pagination": pagination.to_dict(),
        }
    )


# --- Gamification -------------------------------------------------------------


@bp.get("/gamification/points")
@require_role(CITIZEN)
def get_my_points():
    """200 PointsSummary + ledger page.

    Lifetime and monthly totals are SUMs over points_ledger. There is no
    stored total anywhere.
    """
    from app.services.gamification.ledger import history, lifetime_points, monthly_points
    from app.services.queries import Pagination, clamp_page_args

    page, page_size = clamp_page_args(
        request.args.get("page", 1, type=int),
        request.args.get("pageSize", 20, type=int),
        max_page_size=100,
    )
    user = current_user()
    now = datetime.now(UTC)
    rows, total = history(citizen_id=user.id, page=page, page_size=page_size)
    return jsonify(
        {
            "totalLifetimeCsp": lifetime_points(citizen_id=user.id),
            "currentMonthCsp": monthly_points(citizen_id=user.id, year=now.year, month=now.month),
            "ledger": [
                {
                    "id": str(row.id),
                    "complaintId": str(row.complaint_id) if row.complaint_id else None,
                    "reason": row.reason.value,
                    # openapi.yaml: PointsLedgerEntry.amount. NOT `pointsChange`
                    # — that is the column name, and the finished frontend reads
                    # `entry.amount` (GamificationPage.tsx).
                    "amount": row.points_change,
                    "createdAt": _iso(row.created_at),
                }
                for row in rows
            ],
            "pagination": Pagination(page, page_size, total).to_dict(),
        }
    )


@bp.get("/gamification/badges")
@require_role(CITIZEN)
def get_my_badges():
    """200 Badge[] — the badges this citizen has earned, each with its date."""
    from sqlalchemy import select

    from app.extensions import db
    from app.models import Badge, CitizenBadge

    rows = db.session.execute(
        select(Badge, CitizenBadge.earned_at)
        .join(CitizenBadge, CitizenBadge.badge_id == Badge.id)
        .where(CitizenBadge.citizen_id == current_user().id)
        .order_by(CitizenBadge.earned_at)
    ).all()
    return jsonify(
        [
            {
                "code": badge.badge_code.value,
                "name": badge.badge_name,
                "description": badge.description,
                "earnedAt": _iso(earned_at),
            }
            for badge, earned_at in rows
        ]
    )


@bp.get("/leaderboard")
@require_role(CITIZEN)
@validate_query(LeaderboardQuery)
def get_leaderboard_route(query: LeaderboardQuery):
    """200 LeaderboardResponse.

    Sequential ranks, total order (points, then account age, then id),
    DEACTIVATED citizens excluded, zero-point citizens included.
    Handles are `display_name` or a masked fallback — never `full_name`.
    """
    from app.services.gamification.leaderboard import get_leaderboard_service

    now = datetime.now(UTC)
    current, entries, pagination = get_leaderboard_service(
        caller=current_user(),
        scope=query.scope,
        period=query.period,
        page=query.page,
        page_size=query.pageSize,
        now=now,
    )
    return jsonify(
        {
            "scope": query.scope,
            "period": query.period,
            "generatedAt": _iso(now),
            "currentUser": current,
            "data": entries,
            "pagination": pagination.to_dict(),
        }
    )
