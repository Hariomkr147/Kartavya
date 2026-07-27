"""Cross-zone analytics — admin only."""

from __future__ import annotations

from datetime import datetime
from typing import Any


def system_analytics(*, now: datetime) -> dict[str, Any]:
    """GET /admin/analytics — SystemAnalytics. TODO(phase 7).

    Totals across every zone, per-zone ZoneMetrics, and a category breakdown.
    `avgResolutionHours` uses the one shared definition in
    `domain/sla.resolution_hours` — see `analytics/zone.py` for why.
    """
    raise NotImplementedError
