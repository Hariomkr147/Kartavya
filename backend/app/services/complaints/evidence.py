"""Evidence row sequencing and verdict recording.

`complaint_evidence` is append-only: INSERT a new row per photo, never update or
delete a historical one. The single documented exception is the verdict block
(`verdict`, `verdict_reason`, `reviewed_by`, `reviewed_at`), which is null until
an officer reviews that row and is written exactly once.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from flask import current_app
from sqlalchemy import func, select

from app.domain.enums import AiScreenStatus
from app.domain.errors import DomainError, ValidationError
from app.extensions import db
from app.infra.storage import open_photo, remove_photo, store_photo, validate_photo
from app.models import ComplaintEvidence


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

    Each new row starts at ai_screen_status=PENDING. Queuing the screening job
    is the CALLER's job, and it happens after the commit — a 3-photo complaint
    spawns 3 of them, and none of them may block the response.
    """
    if not photos or any(photo is None for photo in photos):
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


def photo_for_signed_request(*, evidence_id: int, upload_dir: Path) -> Path | None:
    """Resolve an evidence row's image for `GET /evidence/{id}/photo`.

    Returns None — never raises — for every "cannot serve this" case: no such
    row, a path that escapes UPLOAD_DIR, or a file missing from disk. The route
    turns all of them into the same 403 it gives a bad signature, because a 404
    here would let anyone enumerate which evidence IDs exist.

    The signature has already been verified by the time this runs; this function
    performs no authorization of its own and must not be called without it.
    """
    evidence = db.session.get(ComplaintEvidence, evidence_id)
    if evidence is None:
        return None
    try:
        return open_photo(file_path=evidence.file_path, upload_dir=upload_dir)
    except DomainError:
        return None
