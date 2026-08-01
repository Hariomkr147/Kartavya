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
from app.domain import severity as severity_domain
from app.domain.enums import AiScreenStatus, ComplaintStatus, PointsReason, StatusActor
from app.domain.errors import ValidationError
from app.extensions import db
from app.infra.storage import store_photo, validate_photo
from app.models import Complaint, ComplaintCategory, ComplaintEvidence, StatusHistory, User, Zone
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

    max_bytes = current_app.config.get("MAX_UPLOAD_BYTES", 5 * 1024 * 1024)
    validated_photos = []
    for photo in photos:
        declared_mime = getattr(photo, "content_type", None)
        mime = validate_photo(stream=photo, declared_mime=declared_mime, max_bytes=max_bytes)
        validated_photos.append((photo, mime))

    upload_dir = Path(current_app.config["UPLOAD_DIR"])
    created_complaint_dir: Path | None = None

    try:
        temp_code = f"TEMP-{uuid.uuid4()}"
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

        # TODO(phase 5): link_new_complaint(...) when services/complaints/clusters.py lands.

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
    *, complaint_id: int, citizen: User, photos: list[Any], note: str | None, now: datetime
) -> Complaint:
    """POST /complaints/{id}/evidence — the citizen answers NEEDS_MORE_EVIDENCE. TODO(phase 4).

    Must accept 1-3 new photos, transition status to UNDER_REVIEW, and log a
    StatusHistory entry.
    """
    raise NotImplementedError


def generate_complaint_code(*, now: datetime, sequence: int) -> str:
    """`KTV-2026-000123`. Human-friendly, unique, and never reused."""
    return f"KTV-{now.year}-{sequence:06d}"
