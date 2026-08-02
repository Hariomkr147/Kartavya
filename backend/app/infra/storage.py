"""Validated photo storage outside the web root."""

from __future__ import annotations

from pathlib import Path
from shutil import copyfileobj
from typing import Any
from uuid import uuid4

from app.domain.errors import ValidationError

MAGIC_BYTES: dict[str, bytes] = {
    "image/jpeg": b"\xff\xd8\xff",
    "image/png": b"\x89PNG\r\n\x1a\n",
}


def detect_mime_type(head: bytes) -> str | None:
    for mime, prefix in MAGIC_BYTES.items():
        if head.startswith(prefix):
            return mime
    return None


def validate_photo(*, stream: Any, declared_mime: str | None, max_bytes: int) -> str:
    """Validate magic bytes and actual stream size, then rewind the stream."""
    del declared_mime  # Client-controlled metadata is deliberately not trusted.
    if stream is None:
        raise ValidationError("Photo file is required.")
    if not hasattr(stream, "read") or not hasattr(stream, "seek"):
        raise ValidationError("Photo file is invalid.")

    stream.seek(0)
    head_size = max(len(prefix) for prefix in MAGIC_BYTES.values())
    detected_mime = detect_mime_type(stream.read(head_size))
    stream.seek(0)
    if detected_mime is None:
        raise ValidationError("Only JPEG and PNG photos are accepted.")

    payload = stream.read(max_bytes + 1)
    stream.seek(0)
    if not payload:
        raise ValidationError("Photo file is empty.")
    if len(payload) > max_bytes:
        raise ValidationError("Photo exceeds the 5 MB upload limit.")
    return detected_mime


def store_photo(*, complaint_id: int, stream: Any, mime_type: str, upload_dir: Path) -> str:
    """Store a photo under a generated name and return its relative path."""
    extension = ".jpg" if mime_type == "image/jpeg" else ".png"
    complaint_dir = upload_dir / str(complaint_id)
    complaint_dir.mkdir(parents=True, exist_ok=True)
    target = complaint_dir / f"{uuid4().hex}{extension}"
    stream.seek(0)
    with target.open("wb") as handle:
        copyfileobj(stream, handle)
    stream.seek(0)
    return target.relative_to(upload_dir).as_posix()


def remove_photo(*, file_path: str, upload_dir: Path) -> None:
    """Best-effort cleanup constrained to the configured upload directory."""
    target = (upload_dir / file_path).resolve()
    root = upload_dir.resolve()
    if not target.is_relative_to(root):
        return
    target.unlink(missing_ok=True)


def open_photo(*, file_path: str, upload_dir: Path) -> Path:
    """Resolve a stored path for serving, refusing anything outside UPLOAD_DIR."""
    from app.domain.errors import ForbiddenError, NotFoundError

    root = upload_dir.resolve()
    target = (upload_dir / file_path).resolve()
    if not target.is_relative_to(root):
        raise ForbiddenError("Invalid file path.")
    if not target.exists() or not target.is_file():
        raise NotFoundError("Photo file not found.")
    return target


def get_evidence_file_path(evidence_id: int) -> str | None:
    from app.extensions import db
    from app.models import ComplaintEvidence

    evidence = db.session.get(ComplaintEvidence, evidence_id)
    return evidence.file_path if evidence else None
