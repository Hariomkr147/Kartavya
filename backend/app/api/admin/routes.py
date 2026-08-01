"""Admin-facing endpoints: category management, staff audit, CSV export, AI zone report."""

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


# --- Categories ---------------------------------------------------------------


@bp.get("/categories")
def list_categories():
    """200 ComplaintCategory[]. Public/all roles.

    TODO(phase 1).
    """
    todo("List categories")


# --- Analytics & Exports ------------------------------------------------------


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
        date_from=query.startDate,
        date_to=query.endDate,
        now=now,
    )

    return Response(
        stream_with_context(generator),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=complaints.csv"},
    )


@bp.post("/admin/zones/<int:zone_id>/ai-report")
@require_role(ADMIN)
def generate_ai_zone_report(zone_id: int):
    """202 Accepted — trigger async generation of AI zone health report.

    TODO(phase 8).
    """
    todo("AI zone report trigger")


@bp.get("/admin/zones/<int:zone_id>/ai-report")
@require_role(ADMIN)
def get_ai_zone_report(zone_id: int):
    """200 AiZoneReport | 404.

    TODO(phase 8).
    """
    todo("AI zone report fetch")
