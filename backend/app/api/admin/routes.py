"""Admin endpoints — cross-zone, and the ONLY package that may emit `reporter`.

Admins are invisible to citizens and officers. Every route here is
`@require_role(ADMIN)`; there are no exceptions and no "admin or officer"
shortcuts. Anything both roles need lives in `app/api/shared/`.
"""

from __future__ import annotations

from datetime import UTC, datetime

from flask import Blueprint, Response, stream_with_context

from app.api.admin.schemas import ExportComplaintsQuery
from app.api.shared.responses import todo
from app.core.auth import require_role
from app.core.validation import validate_query
from app.domain.enums import UserRole

bp = Blueprint("admin", __name__)

ADMIN = UserRole.ADMIN


# --- Complaints ---------------------------------------------------------------


@bp.get("/admin/complaints")
@require_role(ADMIN)
def get_all_complaints():
    """200 ComplaintListResponse across every zone. TODO(phase 7)."""
    todo("Admin complaint list")


@bp.patch("/admin/complaints/<complaint_id>")
@require_role(ADMIN)
def override_complaint(complaint_id: str):
    """200 ComplaintDetail — the override door. Any status, plus zone reassignment.

    TODO(phase 7). Still writes its `status_history` row (actor_role=ADMIN, with
    the reason), and still BACKFILLS the SLA snapshot when the target is
    UNDER_REVIEW-or-later and the clock never started — otherwise `slaLabel`
    comes back silently null on every overridden complaint.
    """
    todo("Complaint override")


@bp.post("/admin/complaints/<complaint_id>/dispute-review")
@require_role(ADMIN)
def review_dispute(complaint_id: str):
    """200 ComplaintDetail — THE ONLY EXIT FROM REOPENED.

    TODO(phase 7). UPHELD -> IN_PROGRESS. REJECTED -> CLOSED with zero points,
    exactly like an auto-close: a losing dispute must not become a second shot
    at the reward the citizen gave up by disputing instead of confirming.
    """
    todo("Dispute review")


# --- Users --------------------------------------------------------------------


@bp.get("/admin/users")
@require_role(ADMIN)
def get_all_users():
    """200 UserListResponse. TODO(phase 7)."""
    todo("User list")


@bp.post("/admin/users")
@require_role(ADMIN)
def create_user():
    """201 User — a CITIZEN or an OFFICER. Never an ADMIN.

    TODO(phase 7). An officer MUST be given a zone; an officer with no zone can
    see nothing at all.
    """
    todo("User creation")


@bp.get("/admin/users/<user_id>")
@require_role(ADMIN)
def get_user_by_id(user_id: str):
    """200 User. TODO(phase 7)."""
    todo("User detail")


@bp.patch("/admin/users/<user_id>")
@require_role(ADMIN)
def update_user(user_id: str):
    """200 User — including deactivation, the RECOMMENDED way to remove someone.

    TODO(phase 7). Takes effect immediately, which works only because every
    request re-reads the user row instead of trusting the token.
    """
    todo("User update")


@bp.delete("/admin/users/<user_id>")
@require_role(ADMIN)
def delete_user(user_id: str):
    """204, or 409 with the blocking counts.

    TODO(phase 7). The audit trails are protected by ON DELETE RESTRICT, so
    count the blockers explicitly first — complaints, ledger rows, notes,
    evidence reviews, status history — and answer 409 with a message that names
    them and recommends deactivation. A bare DELETE surfaces as a 500.
    """
    todo("User deletion")


# --- Zones --------------------------------------------------------------------


@bp.post("/admin/zones")
@require_role(ADMIN)
def create_zone():
    """201 Zone. TODO(phase 7). `zoneCode` is immutable once created."""
    todo("Zone creation")


@bp.patch("/admin/zones/<zone_id>")
@require_role(ADMIN)
def update_zone(zone_id: str):
    """200 Zone.

    TODO(phase 7). A rename changes `zoneName` only. Moving the centre changes
    FUTURE routing but not one existing complaint — a complaint's zone is a
    snapshot. The catch-all zone can never be deactivated.
    """
    todo("Zone update")


@bp.delete("/admin/zones/<zone_id>")
@require_role(ADMIN)
def delete_zone(zone_id: str):
    """204, or 409.

    TODO(phase 7). Blockers: complaints, assigned officers, CITIZENS whose home
    zone this is (easy to forget — registration requires one), and
    `is_catch_all`, which is never deletable.
    """
    todo("Zone deletion")


@bp.post("/admin/zones/<zone_id>/assign-officer")
@require_role(ADMIN)
def assign_officer_to_zone(zone_id: str):
    """200 User.

    TODO(phase 7). Also CLEAR `assignedOfficerId` on every one of that officer's
    non-terminal complaints in the old zone — visibility is zone-scoped and
    re-evaluated per request, so a complaint must never stay assigned to someone
    who now gets a 403 opening it.
    """
    todo("Officer assignment")


# --- SLAs and settings --------------------------------------------------------


@bp.patch("/admin/slas/<category_id>")
@require_role(ADMIN)
def update_sla(category_id: str):
    """200 Category.

    TODO(phase 7). Affects only complaints accepted AFTERWARDS — every complaint
    snapshots its own `sla_target_hours` at acceptance.
    """
    todo("SLA update")


@bp.get("/admin/settings")
@require_role(ADMIN)
def get_settings():
    """200 Settings. TODO(phase 7)."""
    todo("Settings")


@bp.patch("/admin/settings")
@require_role(ADMIN)
def update_settings():
    """200 Settings.

    TODO(phase 7). `autoCloseTimeoutHours` is a LIVE rule: the sweeper re-reads
    it every pass, so lowering it can close a backlog on the next pass and
    raising it hands time back. Nothing already CLOSED is ever reopened.
    """
    todo("Settings update")


# --- Analytics and export -----------------------------------------------------


@bp.get("/admin/analytics")
@require_role(ADMIN)
def get_system_analytics():
    """200 SystemAnalytics — all zones. TODO(phase 7)."""
    todo("System analytics")


@bp.get("/admin/officers/<officer_id>/performance")
@require_role(ADMIN)
def get_officer_performance(officer_id: str):
    """200 OfficerPerformance. TODO(phase 7)."""
    todo("Officer performance")


@bp.get("/admin/export/complaints")
@require_role(ADMIN)
@validate_query(ExportComplaintsQuery)
def export_complaints_csv(query: ExportComplaintsQuery):
    """200 text/csv — streaming CSV of complaints matching query filters."""
    from app.services.analytics.export import generate_complaints_csv_service

    now = datetime.now(UTC)
    generator = generate_complaints_csv_service(
        zone_id=query.zoneId,
        category_id=query.categoryId,
        statuses=query.status,
        sla_label=query.slaLabel,
        date_from=query.dateFrom,
        date_to=query.dateTo,
        now=now,
    )

    return Response(
        stream_with_context(generator),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=complaints.csv"},
    )


# --- AI zone reports ----------------------------------------------------------


@bp.post("/admin/zones/<zone_id>/ai-report")
@require_role(ADMIN)
def generate_ai_zone_report(zone_id: str):
    """202 AiZoneReport at PENDING, returned IMMEDIATELY.

    TODO(phase 8). Fire-and-forget: the request never waits on the model. The
    matching GET is a poll.
    """
    todo("AI zone report generation")


@bp.get("/admin/zones/<zone_id>/ai-report")
@require_role(ADMIN)
def get_ai_zone_report(zone_id: str):
    """200 AiZoneReport — the latest row for the zone.

    TODO(phase 8). When the model was down this returns FAILED with
    `aiAvailable: false`. It does NOT error — AI never breaks a flow.
    """
    todo("AI zone report")
