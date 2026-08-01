"""Admin deltas — the ONLY place in the codebase that emits reporter identity.

That is not a convention, it is the enforcement point. `.importlinter` forbids
the citizen, officer and shared serializers from importing this module, so a
reporter field cannot reach them by accident or by a well-meant refactor.

If you need reporter data anywhere else, the answer is that you do not.
"""

from __future__ import annotations

from typing import Any

from app.api.shared.serializers import SerializationContext, serialize_complaint_detail
from app.models import Complaint, User


def serialize_reporter(user: User) -> dict[str, Any]:
    """The `reporter` block: id, full name, email.

    TODO(phase 7). Emitted by admin complaint views and the CSV export, and
    nowhere else in the system.
    """
    return {
        "id": str(user.id),
        "role": user.role.value,
        "name": user.full_name,
        "email": user.email,
        "displayName": user.display_name,
        "zoneId": str(user.zone_id) if user.zone_id is not None else None,
        "active": user.is_active,
        "createdAt": user.created_at.isoformat() + "Z",
    }


def serialize_complaint_for_admin(
    complaint: Complaint, ctx: SerializationContext
) -> dict[str, Any]:
    """ComplaintDetail plus `reporter`. TODO(phase 7)."""
    payload = serialize_complaint_detail(complaint, ctx)
    reporter = ctx.users.get(complaint.citizen_id)
    payload["reporter"] = serialize_reporter(reporter) if reporter is not None else None
    return payload


def serialize_user(user: User) -> dict[str, Any]:
    """The full `User` shape, including `fullName` and `email`. TODO(phase 7)."""
    return serialize_reporter(user)
