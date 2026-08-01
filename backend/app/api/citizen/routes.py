"""Citizen-facing endpoints: complaints, the feed, points, badges, leaderboard.

A citizen sees only their own data plus the anonymized public feed. Nothing here
may expose another citizen's identity, and nothing here may cross a zone.
"""

from __future__ import annotations

from datetime import UTC, datetime

from flask import Blueprint, jsonify

from app.api.citizen.schemas import FeedQuery, LeaderboardQuery
from app.api.shared.responses import todo
from app.core.auth import current_user, require_auth, require_role
from app.core.validation import validate_query
from app.domain.enums import UserRole

bp = Blueprint("citizen", __name__)

CITIZEN = UserRole.CITIZEN


# --- Complaints ---------------------------------------------------------------


@bp.post("/complaints")
@require_role(CITIZEN)
def create_complaint():
    """201 ComplaintDetail. multipart/form-data: 1-3 photos + fields.

    TODO(phase 3): `services.complaints.submission.create_complaint(...)`.

    `zoneId` is REQUIRED and trusted — the server never routes by location. The
    citizen confirmed the zone, either from photo EXIF GPS via /zones/suggest or
    by picking manually.

    AI screening is fired per photo and must NEVER block this 201.
    """
    todo("Complaint creation")


@bp.get("/complaints/my")
@require_role(CITIZEN)
def get_my_complaints():
    """200 ComplaintListResponse — the citizen dashboard.

    TODO(phase 3). Scoped by `core.scoping.visible_complaints`, which for a
    citizen means `citizen_id == me`.
    """
    todo("My complaints")


@bp.get("/complaints/<complaint_id>")
@require_auth
def get_complaint_by_id(complaint_id: str):
    """200 ComplaintDetail. Any role — the RESPONSE SHAPE is what differs.

    TODO(phase 3).
      * Citizen — their own complaint only, else 403.
      * Officer — their zone only, reporter identity STRIPPED. Zone is
        evaluated against the officer's account right now, re-read every
        request; never the zone claim in the JWT, and never `assignedOfficerId`.
      * Admin — anything, including the reporter.

    Dispatch to the right audience serializer here. Do not build one serializer
    with an `if role ==` inside it — that is exactly the shape of code where a
    privacy leak hides.
    """
    todo("Complaint detail")


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
@validate_query(FeedQuery)
def get_public_feed(query: FeedQuery):
    """200 FeedListResponse — the anonymized zone feed."""
    from app.api.citizen.serializers import serialize_feed_item
    from app.services.complaints.feed import get_public_feed as get_public_feed_service

    now = datetime.now(UTC)
    items, pagination, ctx, upvoted_ids = get_public_feed_service(
        citizen=current_user(),
        query_params=query,
        now=now,
    )

    serialized_items = [
        serialize_feed_item(c, ctx, citizen_upvoted_ids=upvoted_ids) for c in items
    ]
    return jsonify({"data": serialized_items, "pagination": pagination.to_dict()}), 200


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
@validate_query(LeaderboardQuery)
def get_leaderboard(query: LeaderboardQuery):
    """200 LeaderboardResponse.

    TODO(phase 6). Sequential ranks, a total order (points, then account age,
    then id), DEACTIVATED citizens excluded, zero-point citizens included.
    Handles are `display_name` or a masked fallback — never `full_name`.
    """
    from app.services.gamification.leaderboard import get_leaderboard_service

    now = datetime.now(UTC)
    current_user_entry, page_entries, pagination = get_leaderboard_service(
        caller=current_user(),
        scope=query.scope,
        period=query.period,
        page=query.page,
        page_size=query.pageSize,
        now=now,
    )

    return (
        jsonify(
            {
                "scope": query.scope,
                "period": query.period,
                "generatedAt": now.isoformat().replace("+00:00", "Z"),
                "currentUser": current_user_entry,
                "data": page_entries,
                "pagination": pagination.to_dict(),
            }
        ),
        200,
    )
