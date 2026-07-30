"""AI photo pre-screening — fire-and-forget, one job per evidence row."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

from flask import Flask

from app.domain.enums import AiScreenStatus
from app.extensions import db
from app.infra.ai import GuardedProvider, build_provider
from app.models import Complaint, ComplaintCategory, ComplaintEvidence

logger = logging.getLogger(__name__)
_executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="evidence-screening")
_PROVIDER_EXTENSION_KEY = "kartavya_evidence_screening_provider"
_provider_init_lock = Lock()


def _get_screening_provider(app: Flask) -> GuardedProvider:
    """One provider and breaker per Flask application, shared by photo jobs.

    The provider's timeout executor retains the configured evidence-screening
    concurrency, so sharing breaker state does not serialize independent photos.
    """
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
    """Queue one independent background task per new evidence row."""
    if app.config.get("TESTING"):
        return
    provider = _get_screening_provider(app)
    for evidence_id in evidence_ids:
        _executor.submit(screen_evidence, app, evidence_id, provider)


def screen_evidence(
    app: Flask,
    evidence_id: int,
    provider: GuardedProvider | None = None,
) -> None:
    """Screen one photo and write the result back.

    * Submitted on evidence create, re-submission and dispute. A 3-photo
      complaint spawns THREE independent jobs — one slow photo must not hold
      up the other two.
    * ⚠ It must NEVER block the 201. The response goes out with
      `ai_screen_status = PENDING`, and the UI is built to show exactly that.
    * On a result: DONE, plus `ai_matches_category`, `ai_confidence`,
      `ai_note`.
    * On `None` from the provider: UNAVAILABLE. That is not an error path —
      it is a documented outcome the UI renders, and it is how the client
      tells "no result yet" apart from "the model was down".
    * Own session, own commit, inside `with app.app_context():`.
    * ADVISORY ONLY. Never auto-reject a complaint on the model's say-so: a
      rejection costs a real citizen 20 points and a false accusation.
    """
    with app.app_context():
        evidence = db.session.get(ComplaintEvidence, evidence_id)
        if evidence is None:
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
