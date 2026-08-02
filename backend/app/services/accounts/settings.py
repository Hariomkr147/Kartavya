"""The single-row app_settings table, and category SLA edits."""

from __future__ import annotations

from app.core.session import transaction
from app.domain.errors import NotFoundError
from app.extensions import db
from app.models import SETTINGS_ROW_ID, AppSettings, ComplaintCategory, User


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
    settings = db.session.get(AppSettings, SETTINGS_ROW_ID)
    if settings is None:
        with transaction():
            settings = AppSettings(id=SETTINGS_ROW_ID, auto_close_timeout_hours=168)
            db.session.add(settings)
            db.session.flush()
    return settings


def update_settings(*, admin: User, auto_close_timeout_hours: int) -> AppSettings:
    """PATCH /admin/settings. TODO(phase 7).

    `auto_close_timeout_hours` is a LIVE rule, not a per-complaint deadline. The
    sweeper re-reads it every pass, so lowering it can close a backlog on the
    very next pass and raising it hands time back to complaints already waiting.
    Nothing already CLOSED is ever reopened by a change here.
    """
    with transaction():
        settings = db.session.get(AppSettings, SETTINGS_ROW_ID)
        if settings is None:
            settings = AppSettings(id=SETTINGS_ROW_ID)
            db.session.add(settings)
        settings.auto_close_timeout_hours = auto_close_timeout_hours
        settings.updated_by = admin.id
        return settings


def update_category_sla(*, category_id: int, sla_target_hours: int) -> ComplaintCategory:
    """PATCH /admin/slas/{categoryId}. TODO(phase 7).

    Affects only complaints accepted AFTERWARDS. Every complaint snapshots
    `sla_target_hours` at acceptance precisely so an SLA edit cannot retroactively
    make in-flight complaints overdue.
    """
    with transaction():
        category = db.session.get(ComplaintCategory, category_id)
        if category is None:
            raise NotFoundError("No such category.")
        category.sla_hours = sla_target_hours
        return category
