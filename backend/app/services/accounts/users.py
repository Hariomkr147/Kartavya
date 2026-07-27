"""User management: the admin CRUD, plus self-service profile edits."""

from __future__ import annotations

from app.domain.enums import UserRole
from app.models import User


def update_own_profile(
    *, user: User, full_name: str | None, display_name: str | None
) -> User:
    """PATCH /users/me. TODO(phase 2).

    A citizen may change their own `display_name` — the only handle other
    citizens ever see. `full_name` stays private to them and to admins.
    """
    raise NotImplementedError


def create_user(
    *,
    full_name: str,
    email: str,
    password: str,
    role: UserRole,
    zone_id: int | None,
) -> User:
    """POST /admin/users. TODO(phase 7).

    Creates a CITIZEN or an OFFICER — never an ADMIN. An officer MUST have a
    zone: "exactly one zone" is not a soft rule, and an officer with a null
    zone can see nothing at all.
    """
    raise NotImplementedError


def deactivate_user(*, user_id: int) -> User:
    """PATCH /admin/users/{id} with isActive=false. TODO(phase 7).

    The recommended path for removing someone. Takes effect IMMEDIATELY —
    which works only because every request re-loads the user row and re-checks
    `is_active` rather than trusting the token.

    A deactivated citizen drops off the leaderboard while keeping every
    points_ledger row, so reactivating restores their exact standing.
    Deactivation is a moderation tool, not a data deletion.
    """
    raise NotImplementedError


def delete_user(*, user_id: int) -> None:
    """DELETE /admin/users/{id}. TODO(phase 7). Exists to clean up mistakes.

    The schema protects the audit trails with ON DELETE RESTRICT, so a bare
    DELETE raises IntegrityError and surfaces as a 500. Count the blockers
    explicitly first and answer 409 with a message naming them:

      * complaints filed
      * points_ledger rows
      * progress notes authored
      * evidence reviews performed
      * status_history entries

    Recommend deactivation in the message. That is the documented path.
    """
    raise NotImplementedError


def reassign_officer_zone(*, officer_id: int, zone_id: int) -> User:
    """POST /admin/zones/{zoneId}/assign-officer. TODO(phase 7).

    Two effects, and the second is easy to miss: clear `assigned_officer_id` on
    every one of that officer's NON-TERMINAL complaints. Officer visibility is
    zone-scoped and evaluated per request, so leaving them assigned would leave
    complaints owned by someone who now gets a 403 opening them.
    """
    raise NotImplementedError
