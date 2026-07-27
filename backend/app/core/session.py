"""The transaction boundary.

One `commit()` per request, in the service. Routes never commit. Anything that
must be atomic together — status change + history row + points + badge award —
lives inside one service function and therefore one transaction, so a crash
halfway leaves nothing behind.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy.orm import Session

from app.extensions import db


@contextmanager
def transaction() -> Iterator[Session]:
    """Commit on success, roll back on any exception.

        with transaction() as session:
            ...                       # every write for this request
        # committed here, once

    Nesting is safe but pointless: the inner block commits the outer one's work
    too. Prefer one call at the top of the service function.
    """
    session = db.session
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise


@contextmanager
def savepoint() -> Iterator[Session]:
    """A SAVEPOINT, for the batch endpoint.

    `POST /officer/complaints/batch-status` reports per-item success inside a
    single 200 response. Wrapping each item here contains one item's database
    error instead of letting it poison the whole batch.
    """
    session = db.session
    nested = session.begin_nested()
    try:
        yield session
    except Exception:
        nested.rollback()
        raise
