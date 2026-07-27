"""Creating a complaint, re-submitting evidence, and filing a dispute.

Everything that puts a NEW complaint or a NEW evidence row into the system.
Status changes still route through `lifecycle.py`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app.models import Complaint, User


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
) -> Complaint:
    """POST /complaints/{id}/evidence — the citizen answers NEEDS_MORE_EVIDENCE.

    TODO(phase 3). Steps:
      1. Ownership check, then
         `domain.lifecycle.validate_evidence_resubmission(current)`.
      2. Append evidence rows at the NEXT sequence — old rows are always kept.
      3. NEEDS_MORE_EVIDENCE -> EVIDENCE_UNDER_REVIEW via `lifecycle`, RESUMING
         the SLA clock with `domain.sla.resume(...)` if it had already started.
         Pre-acceptance there is nothing to resume and this is a no-op.
      4. Fire the AI screening job for the new photos.
    """
    raise NotImplementedError


def generate_complaint_code(*, now: datetime, sequence: int) -> str:
    """`KTV-2026-000123`. Human-friendly, unique, and never reused."""
    return f"KTV-{now.year}-{sequence:06d}"
