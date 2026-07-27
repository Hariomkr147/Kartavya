"""users, zones, complaint_categories — mirrors schema.dbml."""

from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import UserRole
from app.models.base import TimestampMixin, db, enum_column


class User(TimestampMixin, db.Model):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    #: Real name. NEVER shown to other citizens or to officers — only on
    #: GET /users/me (self) and in admin views.
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)

    #: Public handle for leaderboards. The API falls back to a masked value
    #: ("Citizen #1042") when null; it never falls back to full_name.
    display_name: Mapped[str | None] = mapped_column(String(60))

    #: Unique across ALL roles — this is what stops officers self-registering.
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    role: Mapped[UserRole] = mapped_column(enum_column(UserRole), nullable=False)

    #: Officer: assigned zone (exactly one). Citizen: home zone. Admin: null.
    zone_id: Mapped[int | None] = mapped_column(
        ForeignKey("zones.id", ondelete="RESTRICT")
    )

    #: Soft-deactivate. Inactive users cannot log in, and an inactive citizen
    #: drops off the leaderboard while keeping every points_ledger row, so
    #: reactivating restores their exact standing.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    zone: Mapped[Zone | None] = relationship(back_populates="users", foreign_keys=[zone_id])

    __table_args__ = (
        Index("ix_users_role", "role"),
        Index("ix_users_zone_id", "zone_id"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<User {self.id} {self.role}>"


class Zone(TimestampMixin, db.Model):
    """An admin-managed area, defined only by a centre point.

    Routing is nearest-centroid: a location belongs to whichever active zone's
    centre is closest. No radius, no polygons, no gaps, no overlaps.
    """

    __tablename__ = "zones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    #: Immutable once created. A rename changes zone_name only.
    zone_code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    zone_name: Mapped[str] = mapped_column(String(120), nullable=False)

    center_lat: Mapped[float] = mapped_column(Float, nullable=False)
    center_lng: Mapped[float] = mapped_column(Float, nullable=False)

    #: The "Unassigned" fallback. Exactly one row may have this true, and it can
    #: never be deleted or unset.
    is_catch_all: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    users: Mapped[list[User]] = relationship(
        back_populates="zone", foreign_keys=[User.zone_id]
    )

    __table_args__ = (
        # A PARTIAL unique index, not a column constraint. A plain unique=True
        # would also cap the table at one is_catch_all=false row, blocking every
        # real zone after the first. schema.dbml calls this out specifically.
        Index(
            "ux_zones_catch_all",
            "is_catch_all",
            unique=True,
            sqlite_where=text("is_catch_all = 1"),
            postgresql_where=text("is_catch_all"),
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Zone {self.id} {self.zone_code}>"


class ComplaintCategory(TimestampMixin, db.Model):
    """The 12 fixed categories, seeded once. Only sla_hours is ever edited."""

    __tablename__ = "complaint_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    #: Stable identifier, fixed at seed time. Exposed as Category.code, and the
    #: key `frontend/src/lib/categoryMatcher.ts` writes its keyword lexicon
    #: against — so it must never be edited in place.
    category_code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    category_name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    #: Current target resolution time (>= 1), admin-editable. Only affects
    #: complaints accepted afterwards — each complaint snapshots its own copy.
    sla_hours: Mapped[int] = mapped_column(Integer, nullable=False)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<ComplaintCategory {self.id} {self.category_code}>"


# Note: `updated_at` exists only where schema.dbml has it. These three tables
# deliberately carry `created_at` alone — do not add one "for consistency".
