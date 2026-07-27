"""points_ledger, badges, citizen_badges — mirrors schema.dbml."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.enums import BadgeCode, BadgeCriteriaType, PointsReason
from app.models.base import TimestampMixin, db, enum_column, utcnow


class PointsLedger(TimestampMixin, db.Model):
    """APPEND-ONLY CSP ledger. There is no stored total anywhere, deliberately.

    Lifetime total is `SUM(points_change)`; monthly is the same sum filtered by
    `created_at`. A stored total could silently disagree with its rows; a sum
    cannot.
    """

    __tablename__ = "points_ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    citizen_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    #: The complaint that triggered this change, if any.
    complaint_id: Mapped[int | None] = mapped_column(
        ForeignKey("complaints.id", ondelete="SET NULL")
    )
    #: Signed: +50, +10, +15, +5 or -20. Amounts live in app/domain/points.py.
    points_change: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[PointsReason] = mapped_column(enum_column(PointsReason), nullable=False)

    __table_args__ = (Index("ix_points_ledger_citizen_created", "citizen_id", "created_at"),)


class Badge(TimestampMixin, db.Model):
    """Catalog of the 6 badges, seeded once.

    The criteria columns are what make the award engine data-driven: adding a
    seventh badge should be a seed change, not a code change.
    """

    __tablename__ = "badges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    badge_code: Mapped[BadgeCode] = mapped_column(
        enum_column(BadgeCode), unique=True, nullable=False
    )
    badge_name: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    criteria_type: Mapped[BadgeCriteriaType] = mapped_column(
        enum_column(BadgeCriteriaType), nullable=False
    )
    #: The threshold, where the type needs one (5, 100, 500, 7...). For
    #: CLOSED_WITHIN_DAYS this is the day-window. Null for FIRST_COMPLAINT and
    #: ZONE_RANK_ONE.
    criteria_value: Mapped[int | None] = mapped_column(Integer)
    #: Only used by CLOSED_WITHIN_DAYS — how many closures within the window.
    criteria_count: Mapped[int | None] = mapped_column(Integer)


class CitizenBadge(db.Model):
    """Which citizen earned which badge, and when.

    The unique index guarantees at most one award per citizen per badge — but
    check before inserting, so the service returns a clean result rather than an
    IntegrityError.

    Note this table has `earned_at` and no `created_at`, so it does not use
    TimestampMixin. schema.dbml is the authority on which columns exist.
    """

    __tablename__ = "citizen_badges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    citizen_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    badge_id: Mapped[int] = mapped_column(
        ForeignKey("badges.id", ondelete="RESTRICT"), nullable=False
    )
    earned_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow)

    __table_args__ = (
        UniqueConstraint("citizen_id", "badge_id", name="uq_citizen_badges_citizen_badge"),
    )
