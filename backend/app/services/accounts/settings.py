"""The single-row app_settings table, and category SLA edits."""

from __future__ import annotations

from app.models import AppSettings, ComplaintCategory, User


def list_categories() -> list[ComplaintCategory]:
    """GET /categories — all categories, ordered by name.

    Called from the reference route. Lives here rather than in the route so
    that the route never imports a model directly.
    """
    from app.extensions import db

    return list(
        db.session.scalars(
            db.select(ComplaintCategory).order_by(ComplaintCategory.category_name)
        ).all()
    )


def get_settings() -> AppSettings:
    """GET /admin/settings. TODO(phase 7).

    Always row id = 1. Seeded, so this should never have to create it — but a
    get-or-create keeps a half-seeded dev database from 500ing.
    """
    raise NotImplementedError


def update_settings(*, admin: User, auto_close_timeout_hours: int) -> AppSettings:
    """PATCH /admin/settings. TODO(phase 7).

    `auto_close_timeout_hours` is a LIVE rule, not a per-complaint deadline. The
    sweeper re-reads it every pass, so lowering it can close a backlog on the
    very next pass and raising it hands time back to complaints already waiting.
    Nothing already CLOSED is ever reopened by a change here.
    """
    raise NotImplementedError


def update_category_sla(*, category_id: int, sla_target_hours: int) -> ComplaintCategory:
    """PATCH /admin/slas/{categoryId}. TODO(phase 7).

    Affects only complaints accepted AFTERWARDS. Every complaint snapshots
    `sla_target_hours` at acceptance precisely so an SLA edit cannot retroactively
    make in-flight complaints overdue.
    """
    raise NotImplementedError
