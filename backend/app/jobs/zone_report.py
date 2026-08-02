"""AI zone health reports — fire-and-forget; the matching GET is a poll."""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

from flask import Flask
from sqlalchemy import func, select

from app.domain.enums import AiReportStatus, ComplaintStatus
from app.extensions import db
from app.models.accounts import Zone
from app.models.complaints import Complaint
from app.models.system import AiZoneReport

logger = logging.getLogger(__name__)

_zone_report_pools: dict[str, ThreadPoolExecutor] = {}
_zone_report_lock = threading.Lock()


def _get_zone_report_pool(workers: int) -> ThreadPoolExecutor:
    bounded_workers = min(max(workers, 2), 4)
    cache_key = f"zone-report-{bounded_workers}"
    if cache_key not in _zone_report_pools:
        with _zone_report_lock:
            if cache_key not in _zone_report_pools:
                _zone_report_pools[cache_key] = ThreadPoolExecutor(
                    max_workers=bounded_workers, thread_name_prefix="ai-zone-report"
                )
    return _zone_report_pools[cache_key]


def generate_zone_report(app: Flask, report_id: int) -> None:
    """Fill in a PENDING `ai_zone_reports` row."""
    with app.app_context():
        report = db.session.get(AiZoneReport, report_id)
        if report is None or report.status != AiReportStatus.PENDING:
            return

        zone = db.session.get(Zone, report.zone_id)
        zone_name = zone.zone_name if zone else f"Zone {report.zone_id}"

        # Collect zone stats
        total_complaints = db.session.scalar(
            select(func.count(Complaint.id)).where(Complaint.zone_id == report.zone_id)
        ) or 0

        resolved_complaints = db.session.scalar(
            select(func.count(Complaint.id)).where(
                Complaint.zone_id == report.zone_id,
                Complaint.status.in_([ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED]),
            )
        ) or 0

        open_complaints = total_complaints - resolved_complaints

        stats = {
            "zone_id": report.zone_id,
            "zone_name": zone_name,
            "total_complaints": total_complaints,
            "open_complaints": open_complaints,
            "resolved_complaints": resolved_complaints,
        }

        from app.infra.ai import get_app_provider

        provider = get_app_provider(app)

        res = provider.zone_report(stats)

        if res is not None:
            report.status = AiReportStatus.READY
            report.summary = res.summary
            report.trends = res.trends
            report.hotspots = res.hotspots
            report.suggestions = res.suggestions
            report.ai_available = True
            report.generated_at = datetime.now(UTC)
        else:
            report.status = AiReportStatus.FAILED
            report.ai_available = False
            report.generated_at = datetime.now(UTC)

        try:
            db.session.commit()
        except Exception:
            logger.exception("Failed to save AI zone report %d", report_id)
            db.session.rollback()


def submit_zone_report_job(app: Flask, report_id: int) -> None:
    """Submit AI zone report task to worker pool, or run inline during tests."""
    if app.config.get("TESTING"):
        generate_zone_report(app, report_id)
    else:
        workers = int(app.config.get("AI_WORKER_THREADS", 3))
        _get_zone_report_pool(workers).submit(generate_zone_report, app, report_id)
