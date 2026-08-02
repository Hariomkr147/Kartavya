"""The auto-close sweeper job."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from flask import Flask
from sqlalchemy import select

from app.domain.enums import ComplaintStatus
from app.extensions import db
from app.models.complaints import Complaint
from app.models.system import AppSettings

logger = logging.getLogger(__name__)


def sweep_auto_close(app: Flask) -> int:
    """Close RESOLVED complaints whose confirmation window has elapsed."""
    with app.app_context():
        from app.services.complaints.lifecycle import auto_close

        settings = db.session.get(AppSettings, 1)
        timeout_hours = settings.auto_close_timeout_hours if settings else 168

        now = datetime.now(UTC)
        cutoff_time = now - timedelta(hours=timeout_hours)

        stmt = select(Complaint.id).where(
            Complaint.status == ComplaintStatus.RESOLVED,
            Complaint.resolved_at.is_not(None),
            Complaint.resolved_at <= cutoff_time,
        )

        expired_ids = list(db.session.scalars(stmt).all())
        closed_count = 0

        for cid in expired_ids:
            try:
                auto_close(complaint_id=cid, now=now)
                db.session.commit()
                closed_count += 1
            except Exception:
                logger.exception("Failed to auto-close complaint %d", cid)
                db.session.rollback()

        return closed_count
