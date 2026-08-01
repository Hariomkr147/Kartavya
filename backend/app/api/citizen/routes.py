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
)
from app.api.citizen.serializers import serialize_own_complaint
from app.api.shared.responses import todo
from app.core.auth import current_user, require_auth, require_role
from app.core.validation import parse_model, validate_query
from app.domain.enums import UserRole
from app.domain.errors import NotFoundError, ValidationError
from app.services.complaints.reads import (
    get_citizen_complaints,
    get_complaint_detail,
)
from app.services.complaints.submission import (
    create_complaint as create_complaint_service,
)

bp = Blueprint("citizen", __name__)

CITIZEN = UserRole.CITIZEN


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

    TODO(phase 3). Appends evidence at the next `sequence` (old rows kept) and
    moves the complaint back to EVIDENCE_UNDER_REVIEW, RESUMING the SLA clock if
    it had already started.
    """
    todo("Evidence re-submission")


@bp.post("/complaints/<complaint_id>/upvote")
@require_role(CITIZEN)
def upvote_complaint(complaint_id: str):
    """200 UpvoteResult {upvoteCount, severityScore}.

    TODO(phase 6). 409 ALREADY_UPVOTED on a repeat; no self-upvotes. Credits +5
    to the REPORTER, not the voter, and recomputes severity.
    """
    todo("Upvote")


@bp.post("/complaints/<complaint_id>/confirm")
@require_role(CITIZEN)
def confirm_resolution(complaint_id: str):
    """200 ComplaintDetail — RESOLVED -> CLOSED.

    TODO(phase 6). The ONLY path that credits confirm rewards. Auto-close and an
    admin-rejected dispute both close a complaint with zero points.
    """
    todo("Confirm fix")


@bp.post("/complaints/<complaint_id>/dispute")
@require_role(CITIZEN)
def dispute_resolution(complaint_id: str):
    """200 ComplaintDetail — RESOLVED -> REOPENED. multipart: reason + a photo.

    TODO(phase 6). Both are required — the citizen carries the burden of proof.
    An ADMIN then rules on it, never the officer who did the work.
    """
    todo("Dispute fix")


# --- Feed ---------------------------------------------------------------------


@bp.get("/feed")
@require_role(CITIZEN)
def get_feed_route():
    """200 FeedListResponse — the anonymized zone feed.

    TODO(phase 6). A citizen sees complaints in their home zone only (403 for
    any other zone). Excludes REJECTED and DELETED. The `reporter` object is
    STRUCTURALLY ABSENT from every item.
    """
    todo("Public feed")


# --- Gamification -------------------------------------------------------------


@bp.get("/gamification/points")
@require_role(CITIZEN)
def get_my_points():
    """200 PointsSummary + ledger page.

    TODO(phase 6). Lifetime and monthly totals are SUMs over points_ledger.
    There is no stored total anywhere.
    """
    todo("Points summary")


@bp.get("/gamification/badges")
@require_role(CITIZEN)
def get_my_badges():
    """200 Badge[] — earned and unearned, so the UI can show what is left.

    TODO(phase 6).
    """
    todo("Badges")


@bp.get("/leaderboard")
@require_role(CITIZEN)
def get_leaderboard_route():
    """200 LeaderboardResponse.

    TODO(phase 6). Sequential ranks, total order (points, then account age, then id),
    DEACTIVATED citizens excluded, zero-point citizens included.
    Handles are `display_name` or a masked fallback — never `full_name`.
    """
    todo("Leaderboard")
