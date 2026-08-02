"""Cross-zone analytics — admin only."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select

from app.core.serialization import iso_utc
from app.extensions import db
from app.models import Zone
from app.services.analytics.zone import zone_metrics


def system_analytics(*, now: datetime) -> dict[str, Any]:
    """GET /admin/analytics — SystemAnalytics.

    Totals across every zone, per-zone ZoneMetrics, and a category breakdown.
    `avgResolutionHours` uses the one shared definition in
    `domain/sla.resolution_hours` — see `analytics/zone.py` for why.
    """
    zones = [
        zone_metrics(zone_id=zone.id, now=now)
        for zone in db.session.scalars(select(Zone).order_by(Zone.id))
    ]
    highest = max((zone["overdue"] for zone in zones), default=0)
    for zone in zones:
        zone["isHighestOverdue"] = highest > 0 and zone["overdue"] == highest
    return {"generatedAt": iso_utc(now), "zones": zones}
