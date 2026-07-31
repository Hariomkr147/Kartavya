"""Officer performance — the admin view, and the citizen-safe public view."""

from __future__ import annotations

from datetime import datetime
from typing import Any


def officer_performance(*, officer_id: int, now: datetime) -> dict[str, Any]:
    """GET /admin/officers/{id}/performance — OfficerPerformance. TODO(phase 7).

    Admin only. May name the officer.
    """
    raise NotImplementedError


from sqlalchemy import select, func
from app.models import User, Complaint
from app.domain.enums import UserRole, ComplaintStatus
from app.extensions import db
from app.domain.errors import NotFoundError

def public_officer_stats(*, officer_id: int) -> dict[str, Any]:
    """GET /officers/{id}/stats — any authenticated role. TODO(phase 4).

    Deliberately tiny: a resolved count and nothing else. Officers are
    identified to citizens by ID, never by name, so do NOT add `fullName` here
    however convenient it would be for the UI.
    """
    user = db.session.get(User, officer_id)
    if not user or user.role != UserRole.OFFICER:
        raise NotFoundError("Officer not found")

    resolved_count = db.session.execute(
        select(func.count(Complaint.id))
        .where(
            Complaint.assigned_officer_id == officer_id,
            Complaint.status.in_([ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED])
        )
    ).scalar() or 0

    return {
        "officerId": str(officer_id),
        "totalResolved": resolved_count
    }
