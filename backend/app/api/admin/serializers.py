"""Admin deltas — the ONLY place in the codebase that emits reporter identity.

That is not a convention, it is the enforcement point. `.importlinter` forbids
the citizen, officer and shared serializers from importing this module, so a
reporter field cannot reach them by accident or by a well-meant refactor.

If you need reporter data anywhere else, the answer is that you do not.
"""

from __future__ import annotations

from typing import Any

from app.api.account.schemas import security_fields
from app.api.shared.serializers import serialize_complaint_detail
from app.core.context import SerializationContext
from app.core.serialization import iso_utc
from app.models import Complaint, User


def serialize_reporter(user: User | None) -> dict[str, Any] | None:
    """The `reporter` block: id, full name, email.

    Emitted by admin complaint views and the CSV export, and nowhere else in the system.
    """
    if user is None:
        return None
    return serialize_user(user)


def serialize_user(user: User) -> dict[str, Any]:
    """The full `User` shape, including `fullName` and `email`."""
    return {
        "id": str(user.id),
        "role": user.role.value,
        "name": user.full_name,
        "email": user.email,
        "displayName": user.display_name,
        "zoneId": str(user.zone_id) if user.zone_id else None,
        "active": user.is_active,
        "createdAt": iso_utc(user.created_at),
    }


def serialize_managed_user(user: User) -> dict[str, Any]:
    """`serialize_user` plus the sign-in flags an admin needs to manage the account.

    Deliberately NOT folded into `serialize_user`: that one also builds the
    `reporter` block on complaints, which must stay exactly as it was.
    """
    return {**serialize_user(user), **security_fields(user)}


def serialize_complaint_for_admin(
    complaint: Complaint,
    ctx: SerializationContext,
    evidence_list: list[Any] | None = None,
    history_list: list[Any] | None = None,
    notes_list: list[Any] | None = None,
    reporter_user: User | None = None,
) -> dict[str, Any]:
    """ComplaintDetail plus `reporter`."""
    if reporter_user is None:
        reporter_user = ctx.users.get(complaint.citizen_id)
    data = serialize_complaint_detail(
        complaint,
        ctx,
        evidence_list=evidence_list,
        history_list=history_list,
        notes_list=notes_list,
    )
    data["reporter"] = serialize_reporter(reporter_user)
    return data


def serialize_ai_zone_report(report: Any) -> dict[str, Any]:
    """Serialize AiZoneReport."""
    gen_at = iso_utc(getattr(report, "generated_at", None))
    return {
        "reportId": str(report.id),
        "zoneId": str(report.zone_id),
        "status": report.status.value if hasattr(report.status, "value") else str(report.status),
        "aiAvailable": report.ai_available,
        "generatedAt": gen_at,
        "summary": report.summary,
        "trends": report.trends,
        "hotspots": report.hotspots,
        "suggestions": report.suggestions,
    }
