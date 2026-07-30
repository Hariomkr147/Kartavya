"""Evidence row sequencing and verdict recording.

`complaint_evidence` is append-only: INSERT a new row per photo, never update or
delete a historical one. The single documented exception is the verdict block
(`verdict`, `verdict_reason`, `reviewed_by`, `reviewed_at`), which is null until
an officer reviews that row and is written exactly once.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from flask import current_app
from sqlalchemy import func, select

from app.domain.enums import AiScreenStatus, EvidenceVerdict
from app.extensions import db
from app.infra.storage import remove_photo, store_photo, validate_photo
from app.models import ComplaintEvidence, User


def next_sequence(*, complaint_id: int) -> int:
    """MAX(sequence) + 1 for this complaint.

    1..N are the originals; N+1 onward are re-submissions and
    dispute photos. The unique (complaint_id, sequence) index is the backstop —
    compute this inside the same transaction as the insert.
    """
    current = db.session.execute(
        select(func.max(ComplaintEvidence.sequence)).where(
            ComplaintEvidence.complaint_id == complaint_id
        )
    ).scalar_one()
    return int(current or 0) + 1


def attach_photos(
    *, complaint_id: int, photos: list[Any], now: datetime
) -> list[ComplaintEvidence]:
    """Validate, persist to disk, and insert one evidence row per photo.

    Delegates the file work to `infra/storage.py` (magic-byte
    check, size limit, UUID filename outside the web root) and stores only the
    relative path. Never store the client's filename, and never the bytes.

    Each new row starts at ai_screen_status=PENDING and gets its own
    fire-and-forget screening job — a 3-photo complaint spawns 3 jobs.
    """
    if not photos or any(photo is None for photo in photos):
        from app.domain.errors import ValidationError

        raise ValidationError("A photo is required.")

    upload_dir = current_app.config["UPLOAD_DIR"]
    max_bytes = current_app.config["MAX_UPLOAD_BYTES"]
    rows: list[ComplaintEvidence] = []
    stored_paths: list[str] = []
    sequence = next_sequence(complaint_id=complaint_id)
    try:
        for offset, photo in enumerate(photos):
            mime_type = validate_photo(
                stream=photo.stream,
                declared_mime=photo.mimetype,
                max_bytes=max_bytes,
            )
            file_path = store_photo(
                complaint_id=complaint_id,
                stream=photo.stream,
                mime_type=mime_type,
                upload_dir=upload_dir,
            )
            stored_paths.append(file_path)
            row = ComplaintEvidence(
                complaint_id=complaint_id,
                sequence=sequence + offset,
                file_path=file_path,
                ai_screen_status=AiScreenStatus.PENDING,
                created_at=now,
            )
            db.session.add(row)
            rows.append(row)
        db.session.flush()
        return rows
    except Exception:
        for file_path in stored_paths:
            remove_photo(file_path=file_path, upload_dir=upload_dir)
        raise


def record_verdict(
    *,
    evidence_id: int,
    officer: User,
    verdict: EvidenceVerdict,
    reason: str | None,
    now: datetime,
) -> ComplaintEvidence:
    """Stamp an officer's ruling onto the evidence row it judged.

    TODO(phase 4). `reason` is mandatory for NEEDS_MORE_EVIDENCE and REJECTED —
    the domain check has already enforced that by the time this runs.

    A dispute-evidence row NEVER passes through here: its verdict stays
    permanently null, because the admin judges that photo directly when ruling
    on the dispute, and the ruling lives on status_history.
    """
    raise NotImplementedError


def latest_reviewable(*, complaint_id: int) -> ComplaintEvidence | None:
    """The evidence row an officer's verdict should attach to.

    TODO(phase 4). The highest-sequence row that is not dispute evidence.
    """
    raise NotImplementedError
