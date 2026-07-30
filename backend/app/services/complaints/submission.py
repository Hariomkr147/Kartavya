"""Creating a complaint, re-submitting evidence, and filing a dispute.

Everything that puts a NEW complaint or a NEW evidence row into the system.
Status changes still route through `lifecycle.py`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from flask import current_app

from app.core.session import transaction
from app.domain.enums import ComplaintStatus, StatusActor
from app.domain.errors import ForbiddenError, NotFoundError, raise_for
from app.domain.lifecycle import validate_evidence_resubmission
from app.domain.sla import resume
from app.extensions import db
from app.infra.storage import remove_photo
from app.jobs.screening import submit_evidence_screening
from app.models import Complaint, User
from app.services.complaints.evidence import attach_photos
from app.services.complaints.lifecycle import apply_transition
from app.services.complaints.views import ComplaintDetailData, load_complaint_detail


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
) -> Complaint:
    """POST /complaints — multipart: 1-3 photos plus the fields above.

    TODO(phase 3). One transaction:
      1. Validate: category exists; zone exists AND is active; 1-3 photos.
         The server does NOT route by location — `zoneId` is required and
         trusted. The citizen confirmed it, either from photo EXIF GPS via
         /zones/suggest or by picking manually.
      2. Generate `complaint_code` (KTV-<year>-<zero-padded sequence>).
      3. Insert the complaint at SUBMITTED, with its first `status_history` row
         (from_status NULL — the only row that has one).
      4. Persist each photo via `infra/storage.py` and insert its
         `complaint_evidence` row with sequence 1..N.
      5. `clusters.link_new_complaint(...)` and recompute severity.
      6. If this is the citizen's first-ever complaint: FIRST_COMPLAINT points
         (+10) and the badge check. The badge is filing-triggered, not
         points-triggered.
      7. Fire-and-forget an AI screening job PER PHOTO — never block the 201.

    Returns the created complaint, ready to serialize as ComplaintDetail.
    """
    raise NotImplementedError


def resubmit_evidence(
    *, complaint_id: int, citizen: User, photos: list[Any], note: str | None, now: datetime
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

    submit_evidence_screening(
        current_app._get_current_object(),
        [evidence.id for evidence in evidence_rows],
    )
    return detail


def generate_complaint_code(*, now: datetime, sequence: int) -> str:
    """`KTV-2026-000123`. Human-friendly, unique, and never reused."""
    return f"KTV-{now.year}-{sequence:06d}"
