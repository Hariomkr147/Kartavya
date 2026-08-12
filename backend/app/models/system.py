"""ai_zone_reports, app_settings — mirrors schema.dbml."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.enums import AiReportStatus
from app.models.base import TimestampMixin, db, enum_column, utcnow

#: app_settings is a single-row table. Always this id.
SETTINGS_ROW_ID = 1


class AiZoneReport(TimestampMixin, db.Model):
    """Persisted AI zone health reports, so they can be re-viewed without regenerating.

    POST returns 202 with a PENDING row immediately; the matching GET is a poll
    that returns the latest row for the zone. When the model is unavailable the
    row lands FAILED with ai_available = false — the endpoint never errors.
    """

    __tablename__ = "ai_zone_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id", ondelete="CASCADE"), nullable=False)
    requested_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    status: Mapped[AiReportStatus] = mapped_column(
        enum_column(AiReportStatus), nullable=False, default=AiReportStatus.PENDING
    )
    ai_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    summary: Mapped[str | None] = mapped_column(Text)
    trends: Mapped[str | None] = mapped_column(Text)
    hotspots: Mapped[str | None] = mapped_column(Text)
    suggestions: Mapped[str | None] = mapped_column(Text)

    #: Set when status becomes READY or FAILED.
    generated_at: Mapped[datetime | None] = mapped_column()

    __table_args__ = (Index("ix_ai_zone_reports_zone_created", "zone_id", "created_at"),)


class AppSettings(db.Model):
    """Single-row table (id = 1). Backs GET / PATCH /admin/settings.

    No created_at — schema.dbml gives this table `updated_at` only.
    """

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)

    #: How long a RESOLVED complaint waits for confirmation before auto-closing.
    #: A LIVE rule, not a per-complaint deadline: the sweeper re-reads this every
    #: pass and closes everything where resolved_at + this <= now. Lowering it
    #: can close a backlog on the next pass; raising it hands time back. Nothing
    #: already CLOSED is ever reopened by a change here.
    auto_close_timeout_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=168)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow, onupdate=utcnow)
