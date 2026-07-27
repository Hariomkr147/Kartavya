"""CSV export — admin only."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any


def export_complaints_csv(*, filters: dict[str, Any]) -> Iterator[str]:
    """GET /admin/export/complaints -> text/csv. TODO(phase 7).

    Admin-only, and the ONE surface where reporter identity legitimately leaves
    the system — this is an admin export, and `app/api/admin/` is the only
    package allowed to emit it. Never reuse this writer for an officer-facing
    download.

    Stream it (a generator, `stream_with_context`) rather than building the
    whole file in memory: an unbounded export of every complaint is exactly the
    kind of request that quietly grows past what a single response should hold.

    Reference for the column set: `frontend/src/mocks/lib/csv.ts`.
    """
    raise NotImplementedError
