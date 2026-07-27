"""Officer endpoints — zone-scoped, and identity-free.

The single most important property of this package: NOTHING here emits reporter
identity. Not the queue, not the detail view, not the cascade result. The
compact `Complaint` shape has no reporter field at all, which is why there is
nothing to strip.

A cheap, high-value test for every route in this file:
`assert "reporter" not in response.get_json()`.
"""

from __future__ import annotations

from flask import Blueprint

from app.api.shared.responses import todo
from app.core.auth import require_auth, require_role
from app.domain.enums import UserRole

bp = Blueprint("officer", __name__)

OFFICER = UserRole.OFFICER


@bp.get("/officer/complaints")
@require_role(OFFICER)
def get_officer_queue():
    """200 ComplaintListResponse — this officer's zone queue.

    TODO(phase 4). Start from `core.scoping.visible_complaints(user)`, never
    from `select(Complaint)` plus a filter added later.

    Prefetch for the serializer — categories, zones, upvote counts in ONE
    GROUP BY, first evidence row per complaint. Without that a 20-item page
    becomes 60+ queries, and this endpoint is polled constantly.
    """
    todo("Officer queue")


@bp.post("/officer/complaints/<complaint_id>/claim")
@require_role(OFFICER)
def claim_complaint(complaint_id: str):
    """200 ComplaintDetail — SUBMITTED -> EVIDENCE_UNDER_REVIEW.

    TODO(phase 4). The only door out of SUBMITTED, and it sets
    `assignedOfficerId` in the same statement.

    Two officers WILL race this. The guarded `UPDATE ... WHERE status =
    'SUBMITTED'` is what decides: the loser gets rowcount 0 and a clean 409.
    """
    todo("Claim complaint")


@bp.post("/officer/complaints/<complaint_id>/evidence-review")
@require_role(OFFICER)
def review_evidence(complaint_id: str):
    """200 ComplaintDetail — the photo verdict.

    TODO(phase 4). VALID starts the SLA clock. REJECTED is legal only on a
    complaint's FIRST evidence round (`sla_started_at IS NULL`) and costs the
    citizen -20; on a later round it is a 409. NEEDS_MORE_EVIDENCE and REJECTED
    both require a reason.
    """
    todo("Evidence review")


@bp.patch("/officer/complaints/<complaint_id>/status")
@require_role(OFFICER)
def update_complaint_status(complaint_id: str):
    """200 StatusUpdateResult {complaint, cascade?}.

    TODO(phase 4). Five legal targets; anything else is a schema-level 400.
    RESOLVED on a clustered complaint triggers the cascade, and its per-member
    outcomes come back in `cascade`.
    """
    todo("Status update")


@bp.post("/officer/complaints/batch-status")
@require_role(OFFICER)
def batch_update_status():
    """200 BatchStatusUpdateResult — the only endpoint where partial failure is
    a SUCCESS response.

    TODO(phase 5). Validate all -> apply the valid ones -> ONE commit.
    Per-item failures are `TransitionFailureCode` values in the 200 body.
    An unknown complaint id is a per-item UNKNOWN_COMPLAINT; an unknown
    `clusterId` IS a 404. Exactly one of `complaintIds` / `clusterId`.
    """
    todo("Batch status update")


@bp.post("/officer/complaints/<complaint_id>/notes")
@require_role(OFFICER)
def add_progress_note(complaint_id: str):
    """201 ProgressNote — up to 500 chars, permanent, citizen-visible.

    TODO(phase 4). Shown to the citizen with the officer's ID, never their name.
    """
    todo("Progress note")


@bp.post("/officer/clusters/<cluster_id>/notes")
@require_role(OFFICER)
def add_cluster_progress_note(cluster_id: str):
    """201 — one note fanned out to every complaint in the cluster.

    TODO(phase 5). An unknown cluster id is a 404 here.
    """
    todo("Cluster progress note")


@bp.get("/officer/analytics")
@require_role(OFFICER)
def get_officer_analytics():
    """200 ZoneAnalytics — for THIS officer's zone only.

    TODO(phase 5). `avgResolutionHours` is
    `resolved_at - sla_started_at - sla_paused_seconds`. Do not copy the mock,
    which computes it three other ways.
    """
    todo("Officer analytics")


@bp.get("/officers/<officer_id>/stats")
@require_auth
def get_public_officer_stats(officer_id: str):
    """200 PublicOfficerStats — any authenticated role, including citizens.

    TODO(phase 4). Deliberately tiny: a resolved count. No name, ever.
    """
    todo("Public officer stats")
