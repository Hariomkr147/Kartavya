"""Creating a complaint, re-submitting evidence, and filing a dispute.

Everything that puts a NEW complaint or a NEW evidence row into the system.
Status changes still route through `lifecycle.py`.
"""

from __future__ import annotations

import logging
import shutil
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import current_app
from sqlalchemy import func, select

from app.core.context import SerializationContext
from app.core.session import transaction
from app.domain import severity as severity_domain
from app.domain.enums import AiScreenStatus, ComplaintStatus, PointsReason, StatusActor
from app.domain.errors import ForbiddenError, NotFoundError, ValidationError, raise_for
from app.domain.lifecycle import validate_evidence_resubmission
from app.domain.sla import resume
from app.extensions import db
from app.infra.storage import remove_photo, store_photo, validate_photo
from app.models import Complaint, ComplaintCategory, ComplaintEvidence, StatusHistory, User, Zone
from app.services.complaints.clusters import link_new_complaint
from app.services.complaints.evidence import attach_photos
from app.services.complaints.lifecycle import apply_transition
from app.services.complaints.views import ComplaintDetailData, load_complaint_detail
from app.services.gamification.ledger import award

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ComplaintCreateResult:
    complaint: Complaint
    ctx: SerializationContext
    evidence: list[ComplaintEvidence]
    history: list[StatusHistory]
    notes: list[Any]


def create_complaint(
    *,
    citizen: User,
    category_id: int,
    zone_id: int,
    latitude: float,
    longitude: float,
    description: str | None,
    category_suggested_by_matcher: bool,
    photos: list[Any],
    now: datetime,
) -> ComplaintCreateResult:
    """POST /complaints — multipart: 1-3 photos plus the fields above."""
    if not photos or not (1 <= len(photos) <= 3):
        raise ValidationError("Must submit between 1 and 3 photos.")

    category = db.session.get(ComplaintCategory, category_id)
    if not category:
        raise ValidationError("The specified category does not exist.")

    zone = db.session.get(Zone, zone_id)
    if not zone or not zone.is_active:
        raise ValidationError("The specified zone does not exist or is inactive.")

    max_bytes = current_app.config.get("MAX_UPLOAD_BYTES", 1 * 1024 * 1024)
    validated_photos = []
    for photo in photos:
        declared_mime = getattr(photo, "content_type", None)
        mime = validate_photo(stream=photo, declared_mime=declared_mime, max_bytes=max_bytes)
        validated_photos.append((photo, mime))

    upload_dir = Path(current_app.config["UPLOAD_DIR"])
    created_complaint_dir: Path | None = None

    try:
        # Placeholder only: the real code needs the autoincrement id, assigned
        # after the flush below. Must fit complaint_code's varchar(30).
        temp_code = f"TEMP-{uuid.uuid4().hex[:20]}"
        initial_severity = severity_domain.score(unique_reporter_count=1, upvotes=0)

        complaint = Complaint(
            complaint_code=temp_code,
            citizen_id=citizen.id,
            zone_id=zone_id,
            category_id=category_id,
            description=description,
            category_suggested_by_matcher=category_suggested_by_matcher,
            latitude=latitude,
            longitude=longitude,
            status=ComplaintStatus.SUBMITTED,
            severity_score=initial_severity,
            created_at=now,
            updated_at=now,
        )
        db.session.add(complaint)
        db.session.flush()

        complaint.complaint_code = generate_complaint_code(now=now, sequence=complaint.id)
        created_complaint_dir = upload_dir / str(complaint.id)

        history_entry = StatusHistory(
            complaint_id=complaint.id,
            from_status=None,
            to_status=ComplaintStatus.SUBMITTED,
            actor_role=StatusActor.CITIZEN,
            changed_by_user_id=citizen.id,
            created_at=now,
        )
        db.session.add(history_entry)

        evidence_records = []
        for sequence, (photo_stream, mime_type) in enumerate(validated_photos, start=1):
            rel_path = store_photo(
                complaint_id=complaint.id,
                stream=photo_stream,
                mime_type=mime_type,
                upload_dir=upload_dir,
            )
            evidence = ComplaintEvidence(
                complaint_id=complaint.id,
                sequence=sequence,
                file_path=rel_path,
                ai_screen_status=AiScreenStatus.PENDING,
                created_at=now,
            )
            db.session.add(evidence)
            evidence_records.append(evidence)

        db.session.flush()

        link_new_complaint(
            complaint=complaint,
            radius_meters=current_app.config["CLUSTER_RADIUS_METERS"],
            now=now,
        )

        # Award FIRST_COMPLAINT points (+10) if this is citizen's first complaint.
        # NOTE (Phase 3): FIRST_COMPLAINT points award (+10 points) is fully implemented here
        # during complaint creation, so Phase 6 does not re-implement it.
        existing_count = (
            db.session.scalar(
                select(func.count(Complaint.id)).where(
                    Complaint.citizen_id == citizen.id,
                    Complaint.id != complaint.id,
                )
            )
            or 0
        )

        if existing_count == 0:
            award(
                citizen_id=citizen.id,
                complaint_id=complaint.id,
                reason=PointsReason.FIRST_COMPLAINT,
                now=now,
            )

        categories = {c.id: c for c in db.session.scalars(select(ComplaintCategory)).all()}
        zones = {z.id: z for z in db.session.scalars(select(Zone)).all()}

        ctx = SerializationContext(
            now=now,
            categories=categories,
            zones=zones,
            upvote_counts={complaint.id: 0},
            first_evidence={complaint.id: evidence_records[0]} if evidence_records else {},
        )

        db.session.commit()
    except Exception:
        db.session.rollback()
        if created_complaint_dir and created_complaint_dir.exists():
            shutil.rmtree(created_complaint_dir, ignore_errors=True)
        raise

    from app.jobs.screening import submit_evidence_screening_job

    app_obj = current_app._get_current_object()
    has_status_updates = False
    for ev in evidence_records:
        try:
            submit_evidence_screening_job(app_obj, ev.id)
        except Exception:
            logger.exception("Failed to submit AI screening job for evidence %d", ev.id)
            ev.ai_screen_status = AiScreenStatus.UNAVAILABLE
            has_status_updates = True

    if has_status_updates:
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()

    return ComplaintCreateResult(
        complaint=complaint,
        ctx=ctx,
        evidence=evidence_records,
        history=[history_entry],
        notes=[],
    )


def resubmit_evidence(
    *, complaint_id: int, citizen: User, photos: list[Any], now: datetime
) -> ComplaintDetailData:
    """POST /complaints/{id}/evidence — the citizen answers NEEDS_MORE_EVIDENCE.

    Steps:
      1. Ownership check, then
         `domain.lifecycle.validate_evidence_resubmission(current)`.
      2. Append evidence rows at the NEXT sequence — old rows are always kept.
      3. NEEDS_MORE_EVIDENCE -> EVIDENCE_UNDER_REVIEW via `lifecycle`, RESUMING
         the SLA clock with `domain.sla.resume(...)` if it had already started.
         Pre-acceptance there is nothing to resume and this is a no-op.
      4. Fire the AI screening job for the new photos.
    """
    evidence_rows = []
    try:
        with transaction():
            complaint = db.session.get(Complaint, complaint_id)
            if complaint is None:
                raise NotFoundError("No such complaint.")
            if complaint.citizen_id != citizen.id:
                raise ForbiddenError("You do not have access to this complaint.")
            raise_for(validate_evidence_resubmission(complaint.status))

            paused_seconds, paused_at = resume(
                complaint.sla_paused_seconds,
                complaint.sla_paused_at,
                now,
            )
            apply_transition(
                complaint_id=complaint.id,
                expected_status=ComplaintStatus.NEEDS_MORE_EVIDENCE,
                new_status=ComplaintStatus.EVIDENCE_UNDER_REVIEW,
                actor_role=StatusActor.CITIZEN,
                changed_by_user_id=citizen.id,
                now=now,
                extra_values={
                    "sla_paused_seconds": paused_seconds,
                    "sla_paused_at": paused_at,
                },
            )
            # Let the guarded transition choose the winner before allocating an
            # evidence sequence. Otherwise two retries can both choose N+1 and
            # the loser fails with a unique-index 500 before reaching the guard.
            evidence_rows = attach_photos(
                complaint_id=complaint.id,
                photos=photos,
                now=now,
            )
            detail = load_complaint_detail(complaint_id=complaint.id)
    except Exception:
        for evidence in evidence_rows:
            remove_photo(
                file_path=evidence.file_path,
                upload_dir=current_app.config["UPLOAD_DIR"],
            )
        raise

    # Imported here, not at module scope: `jobs/auto_close.py` has to import this
    # package back (every SYSTEM status change goes through lifecycle.py too), so
    # a module-level edge in this direction would close the loop.
    from app.jobs.screening import submit_evidence_screening

    submit_evidence_screening(
        current_app._get_current_object(),
        [evidence.id for evidence in evidence_rows],
    )
    return detail


def generate_complaint_code(*, now: datetime, sequence: int) -> str:
    """`KTV-2026-000123`. Human-friendly, unique, and never reused."""
    return f"KTV-{now.year}-{sequence:06d}"
