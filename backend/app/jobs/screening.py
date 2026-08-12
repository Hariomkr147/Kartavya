"""Fire-and-forget AI photo screening, one job per evidence row."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Lock

from flask import Flask
from sqlalchemy import select, update

from app.domain.enums import AiScreenStatus
from app.extensions import db
from app.infra.ai import GuardedProvider, build_provider
from app.models import Complaint, ComplaintCategory, ComplaintEvidence
from app.models.base import utcnow

logger = logging.getLogger(__name__)

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


def sweep_screening_retries(app: Flask) -> int:
    """Re-queue evidence whose screening never landed. Returns rows re-queued.

    Two populations, both currently permanent dead ends:

    UNAVAILABLE
        The provider returned nothing — it was down, the key was missing, or
        the circuit breaker was open. With a rate-limited free model that
        happens in bursts: the breaker opens for its cooldown and *every*
        photo uploaded in that window is marked UNAVAILABLE without a call
        even being attempted. Nothing retries them, so a spike permanently
        leaves a batch unscreened.

    PENDING, but old
        The fire-and-forget task died with its process — a deploy, a restart,
        a crash mid-flight. Nothing else ever picks these up, so they sit
        PENDING for the life of the row.

    Bounded by AGE, not by a per-row attempt count: `complaint_evidence` has
    no attempts column, and adding one is a change to schema.dbml rather than
    something to invent here. Rows past the window are never retried again,
    and each sweep is capped, so a genuinely dead provider costs a fixed,
    small number of calls per interval rather than looping forever.

    `screen_evidence` still only screens PENDING rows. Rather than relaxing
    that guard — it is what stops a DONE verdict being silently overwritten —
    this moves the row back to PENDING first, which is a legitimate
    transition for "we are going to try again".
    """
    if not app.config.get("AI_SCREENING_ENABLED", True):
        return 0

    with app.app_context():
        now = utcnow()  # naive UTC, matching what TimestampMixin stores
        retry_after = now - timedelta(hours=app.config["AI_SCREENING_RETRY_WINDOW_HOURS"])
        stale_before = now - timedelta(minutes=app.config["AI_SCREENING_STALE_PENDING_MINUTES"])
        batch = app.config["AI_SCREENING_RETRY_BATCH"]

        unavailable_ids = list(
            db.session.scalars(
                select(ComplaintEvidence.id)
                .where(
                    ComplaintEvidence.ai_screen_status == AiScreenStatus.UNAVAILABLE,
                    ComplaintEvidence.created_at >= retry_after,
                )
                .order_by(ComplaintEvidence.created_at.desc())
                .limit(batch)
            ).all()
        )

        # Already PENDING, so there is no status to flip — only a task to
        # re-submit. The staleness threshold is far longer than a screening
        # call can take, so a task genuinely in flight is never duplicated.
        stale_pending_ids = list(
            db.session.scalars(
                select(ComplaintEvidence.id)
                .where(
                    ComplaintEvidence.ai_screen_status == AiScreenStatus.PENDING,
                    ComplaintEvidence.created_at <= stale_before,
                    ComplaintEvidence.created_at >= retry_after,
                )
                .order_by(ComplaintEvidence.created_at.desc())
                .limit(batch)
            ).all()
        )

        requeued: list[int] = []

        for evidence_id in unavailable_ids:
            # Conditional UPDATE, not a read-then-write: rowcount is the
            # decision, so two sweeps (or two workers) cannot both claim the
            # same row and screen it twice.
            claimed = db.session.execute(
                update(ComplaintEvidence)
                .where(
                    ComplaintEvidence.id == evidence_id,
                    ComplaintEvidence.ai_screen_status == AiScreenStatus.UNAVAILABLE,
                )
                .values(ai_screen_status=AiScreenStatus.PENDING)
            ).rowcount
            if claimed:
                requeued.append(evidence_id)

        try:
            db.session.commit()
        except Exception:
            logger.exception("Failed to reset evidence rows for re-screening")
            db.session.rollback()
            return 0

        # Only submit AFTER the commit: a task that starts against an
        # uncommitted status would read UNAVAILABLE and no-op on the guard.
        to_screen = requeued + stale_pending_ids
        if to_screen:
            submit_evidence_screening(app, to_screen)
            logger.info(
                "Re-queued %d evidence photo(s) for AI screening "
                "(%d unavailable, %d stale pending).",
                len(to_screen),
                len(requeued),
                len(stale_pending_ids),
            )
        return len(to_screen)
