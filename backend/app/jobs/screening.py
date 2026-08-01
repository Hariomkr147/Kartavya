"""AI photo pre-screening — fire-and-forget, one job per evidence row."""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor

from flask import Flask

from app.domain.enums import AiScreenStatus
from app.extensions import db
from app.infra.ai import get_app_provider
from app.models.accounts import ComplaintCategory
from app.models.complaints import Complaint, ComplaintEvidence

logger = logging.getLogger(__name__)

_screening_pools: dict[int, ThreadPoolExecutor] = {}
_screening_lock = threading.Lock()


def _get_screening_pool(workers: int) -> ThreadPoolExecutor:
    bounded_workers = min(max(workers, 2), 4)
    if bounded_workers not in _screening_pools:
        with _screening_lock:
            if bounded_workers not in _screening_pools:
                _screening_pools[bounded_workers] = ThreadPoolExecutor(
                    max_workers=bounded_workers, thread_name_prefix="ai-screening"
                )
    return _screening_pools[bounded_workers]


def screen_evidence(app: Flask, evidence_id: int) -> None:
    """Screen one photo and write the result back."""
    with app.app_context():
        evidence = db.session.get(ComplaintEvidence, evidence_id)
        if evidence is None or evidence.ai_screen_status != AiScreenStatus.PENDING:
            return

        complaint = db.session.get(Complaint, evidence.complaint_id)
        category = (
            db.session.get(ComplaintCategory, complaint.category_id) if complaint else None
        )
        category_code = category.category_code if category else "UNKNOWN"

        provider = get_app_provider(app)

        upload_dir = app.config.get("UPLOAD_DIR")
        photo_path = str(upload_dir / evidence.file_path) if upload_dir else evidence.file_path

        res = provider.screen_photo(
            path=photo_path,
            category=category_code,
        )

        if res is not None:
            evidence.ai_screen_status = AiScreenStatus.DONE
            evidence.ai_matches_category = res.matches_category
            evidence.ai_confidence = res.confidence
            evidence.ai_note = res.note
        else:
            evidence.ai_screen_status = AiScreenStatus.UNAVAILABLE

        try:
            db.session.commit()
        except Exception:
            logger.exception("Failed to save evidence screening result %d", evidence_id)
            db.session.rollback()


def submit_evidence_screening_job(app: Flask, evidence_id: int) -> None:
    """Submit AI evidence screening task to worker pool, or run inline in TESTING mode."""
    if app.config.get("TESTING"):
        screen_evidence(app, evidence_id)
    else:
        workers = int(app.config.get("AI_WORKER_THREADS", 3))
        _get_screening_pool(workers).submit(screen_evidence, app, evidence_id)
