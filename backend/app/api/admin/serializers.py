"""Admin deltas — the ONLY place in the codebase that emits reporter identity.

That is not a convention, it is the enforcement point. `.importlinter` forbids
the citizen, officer and shared serializers from importing this module, so a
reporter field cannot reach them by accident or by a well-meant refactor.

If you need reporter data anywhere else, the answer is that you do not.
"""

from __future__ import annotations

from typing import Any

from app.api.shared.serializers import SerializationContext
from app.models import Complaint, User


def serialize_reporter(user: User) -> dict[str, Any]:
    """The `reporter` block: id, full name, email.

    TODO(phase 7). Emitted by admin complaint views and the CSV export, and
    nowhere else in the system.
    """
    raise NotImplementedError


def serialize_complaint_for_admin(
    complaint: Complaint, ctx: SerializationContext
) -> dict[str, Any]:
    """ComplaintDetail plus `reporter`. TODO(phase 7)."""
    raise NotImplementedError


def serialize_user(user: User) -> dict[str, Any]:
    """The full `User` shape, including `fullName` and `email`. TODO(phase 7)."""
    raise NotImplementedError
