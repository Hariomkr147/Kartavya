"""Wire-format helpers shared by every layer that emits JSON.

One rule, one implementation. `datetime.isoformat() + "Z"` was previously
open-coded in six places, which is wrong twice over: it emits `+00:00Z` for an
aware datetime, and it silently omits the designator when someone forgets the
concatenation — which is how `ProgressNote.createdAt` ended up in two different
formats depending on which endpoint served it. A JavaScript client reading a
bare `2026-08-02T15:58:18` parses it as LOCAL time, so the omission is a real
off-by-hours bug, not a cosmetic one.
"""

from __future__ import annotations

from datetime import UTC, datetime


def iso_utc(value: datetime | None) -> str | None:
    """Render a timestamp as RFC 3339 UTC with an explicit `Z`.

    Naive values are assumed to be UTC, which is what the whole system stores:
    SQLite has no timezone type, so `models.base.utcnow()` writes naive UTC and
    everything read back is naive.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
