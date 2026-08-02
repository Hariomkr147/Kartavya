"""Fire-and-forget AI photo screening, one job per evidence row."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Lock

from flask import Flask

from app.domain.enums import AiScreenStatus
from app.extensions import db
from app.infra.ai import GuardedProvider, build_provider
from app.models import Complaint, ComplaintCategory, ComplaintEvidence

_executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="evidence-screening")
_PROVIDER_EXTENSION_KEY = "kartavya_evidence_screening_provider"
_provider_init_lock = Lock()


def _get_screening_provider(app: Flask) -> GuardedProvider:
    """Return the shared provider and circuit breaker for one Flask app."""
    provider = app.extensions.get(_PROVIDER_EXTENSION_KEY)
    if provider is not None:
        return provider
    with _provider_init_lock:
        provider = app.extensions.get(_PROVIDER_EXTENSION_KEY)
        if provider is None:
            provider = build_provider(
                app.config["AI_PROVIDER"],
                timeout_seconds=app.config["AI_TIMEOUT_SECONDS"],
                failure_threshold=app.config["AI_BREAKER_FAILURE_THRESHOLD"],
                cooldown_seconds=app.config["AI_BREAKER_COOLDOWN_SECONDS"],
                executor_workers=app.config["AI_WORKER_THREADS"],
            )
            app.extensions[_PROVIDER_EXTENSION_KEY] = provider
    return provider


def submit_evidence_screening(app: Flask, evidence_ids: list[int]) -> None:
    """Queue independent background screening tasks for newly appended evidence."""
    if not app.config.get("AI_SCREENING_ENABLED", True):
        return
    provider = _get_screening_provider(app)
    for evidence_id in evidence_ids:
        _executor.submit(screen_evidence, app, evidence_id, provider)


def submit_evidence_screening_job(app: Flask, evidence_id: int) -> None:
    """Compatibility wrapper for the Phase 3 complaint-creation service."""
    submit_evidence_screening(app, [evidence_id])


def screen_evidence(
    app: Flask,
    evidence_id: int,
    provider: GuardedProvider | None = None,
) -> None:
    """Screen one pending photo and persist only advisory AI fields."""
    with app.app_context():
        evidence = db.session.get(ComplaintEvidence, evidence_id)
        if evidence is None or evidence.ai_screen_status is not AiScreenStatus.PENDING:
            return
        complaint = db.session.get(Complaint, evidence.complaint_id)
        if complaint is None:
            return
        category = db.session.get(ComplaintCategory, complaint.category_id)
        if category is None:
            return

        provider = provider or _get_screening_provider(app)
        path = app.config["UPLOAD_DIR"] / evidence.file_path
        result = provider.screen_photo(str(path), category.category_name)
        if result is None:
            evidence.ai_screen_status = AiScreenStatus.UNAVAILABLE
        else:
            evidence.ai_screen_status = AiScreenStatus.DONE
            evidence.ai_matches_category = result.matches_category
            evidence.ai_confidence = result.confidence
            evidence.ai_note = result.note
        db.session.commit()
