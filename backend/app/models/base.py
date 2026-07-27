"""Column helpers, mixins, and the SQLite PRAGMAs the schema depends on.

`backend/database/schema.dbml` is authoritative for every column name, type,
nullability, index and delete rule. Do not improve on it here.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import TypeVar

from sqlalchemy import Engine, Enum as SAEnum, event
from sqlalchemy.orm import Mapped, mapped_column

from app.extensions import db

__all__ = ["db", "TimestampMixin", "enum_column", "utcnow"]

E = TypeVar("E", bound=StrEnum)


def utcnow() -> datetime:
    """Naive UTC — SQLite has no timezone type, so everything stored is UTC.

    Domain functions take `now` as an argument; this is only for column defaults
    and for the places a service genuinely needs the wall clock.
    """
    return datetime.now(UTC).replace(tzinfo=None)


def enum_column(enum_type: type[E]) -> SAEnum:
    """Render a Python enum as a CHECK-constrained VARCHAR.

    `native_enum=False` is what the schema's design note intends: SQLite has no
    ENUM type, so the value set is enforced by a CHECK constraint instead. A
    typo'd status then cannot be stored, which is the whole point of the enums
    in schema.dbml.
    """
    return SAEnum(
        enum_type,
        native_enum=False,
        validate_strings=True,
        length=40,
        values_callable=lambda e: [member.value for member in e],
    )


class TimestampMixin:
    """`created_at` on everything; `updated_at` only where the schema has it."""

    created_at: Mapped[datetime] = mapped_column(default=utcnow, nullable=False)


@event.listens_for(Engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
    """Turn on the guarantees SQLite disables by default.

    Without `foreign_keys=ON`, every RESTRICT and CASCADE rule in schema.dbml is
    silently inert — deletes that the schema is supposed to block succeed, and
    the audit trails this system is built around can be orphaned.

    Guarded by a driver check so a future Postgres move does not break here.
    """
    if type(dbapi_connection).__module__.split(".")[0] != "sqlite3":
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")  # readers do not block on a writer
    cursor.execute("PRAGMA busy_timeout=5000")  # wait for a lock, do not fail instantly
    cursor.close()
