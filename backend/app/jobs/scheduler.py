"""One APScheduler instance, started in create_app().

Threads, not processes, while we are on SQLite: several gunicorn *processes*
against one SQLite file produce SQLITE_BUSY under write contention.
"""

from __future__ import annotations

import atexit
import logging
import os

from apscheduler.schedulers.background import BackgroundScheduler
from flask import Flask

logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler(daemon=True)


def _is_reloader_parent() -> bool:
    """True in the Flask dev reloader's PARENT process.

    Without this check the dev server starts two schedulers and every job runs
    twice — including the auto-close sweeper, which is idempotent, and any job
    that is not, which would be worse.
    """
    return os.environ.get("WERKZEUG_RUN_MAIN") != "true" and os.environ.get("FLASK_DEBUG") == "1"


def init_scheduler(app: Flask) -> None:
    """Register the recurring jobs and start the scheduler.

    Only the SWEEPER is scheduled here. The two AI jobs are fire-and-forget:
    they are submitted when a photo is uploaded or a report is requested, not on
    a timer.
    """
    if not app.config.get("SCHEDULER_ENABLED", True):
        logger.info("Scheduler disabled by configuration.")
        return
    if _is_reloader_parent():
        return
    if scheduler.running:  # pragma: no cover - defensive
        return

    from app.jobs.auto_close import sweep_auto_close

    scheduler.add_job(
        func=lambda: sweep_auto_close(app),
        trigger="interval",
        minutes=app.config["AUTO_CLOSE_SWEEP_MINUTES"],
        id="auto_close_sweeper",
        replace_existing=True,
        # If the app was down over several intervals, run once on return rather
        # than firing every missed interval in a burst.
        coalesce=True,
        max_instances=1,
    )
    from app.jobs.screening import sweep_screening_retries

    scheduler.add_job(
        func=lambda: sweep_screening_retries(app),
        trigger="interval",
        minutes=app.config["AI_SCREENING_RETRY_MINUTES"],
        id="ai_screening_retry_sweeper",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )

    scheduler.start()
    atexit.register(lambda: scheduler.shutdown(wait=False))
    logger.info(
        "Scheduler started; auto-close sweep every %s minutes, "
        "AI screening retry sweep every %s minutes.",
        app.config["AUTO_CLOSE_SWEEP_MINUTES"],
        app.config["AI_SCREENING_RETRY_MINUTES"],
    )
