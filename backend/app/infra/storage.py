"""Validated photo storage, dispatched to a backend by STORAGE_PROVIDER.

`store_photo`, `remove_photo`, and `read_photo_bytes` are the facade every
caller outside `app/infra/` imports — `local` (this file, disk under
UPLOAD_DIR) and `supabase` (app/infra/storage_supabase.py, Supabase Storage
over its REST API) are equivalent behind it, so nothing in `app/services/`,
`app/api/`, or `app/jobs/` needs to know which one is active.
"""

from __future__ import annotations

from pathlib import Path
from shutil import copyfileobj
from typing import Any
from uuid import uuid4

from flask import current_app

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
        raise ValidationError("Photo exceeds the 1 MB upload limit.")
    return detected_mime


def _using_supabase() -> bool:
    return (current_app.config.get("STORAGE_PROVIDER") or "local").strip().lower() == "supabase"


def store_photo(*, complaint_id: int, stream: Any, mime_type: str, upload_dir: Path) -> str:
    """Store a photo under a generated name and return the key to persist in file_path."""
    if _using_supabase():
        from app.infra.storage_supabase import store_photo as _store_remote

        return _store_remote(complaint_id=complaint_id, stream=stream, mime_type=mime_type)

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
    """Best-effort cleanup, constrained to the configured upload directory on `local`."""
    if _using_supabase():
        from app.infra.storage_supabase import remove_photo as _remove_remote

        _remove_remote(file_path=file_path)
        return

    target = (upload_dir / file_path).resolve()
    root = upload_dir.resolve()
    if not target.is_relative_to(root):
        return
    target.unlink(missing_ok=True)


def open_photo(*, file_path: str, upload_dir: Path) -> Path:
    """Resolve a stored path on the `local` backend, refusing anything outside UPLOAD_DIR."""
    from app.domain.errors import ForbiddenError, NotFoundError

    root = upload_dir.resolve()
    target = (upload_dir / file_path).resolve()
    if not target.is_relative_to(root):
        raise ForbiddenError("Invalid file path.")
    if not target.exists() or not target.is_file():
        raise NotFoundError("Photo file not found.")
    return target


def read_photo_bytes(*, file_path: str, upload_dir: Path) -> bytes | None:
    """Read one photo's raw bytes regardless of backend.

    Returns None — never raises — for every "cannot serve this" case: a path
    that escapes UPLOAD_DIR, a file missing from disk, or a Supabase object
    that 404s. Callers (the signed photo route, AI screening) only need to
    know whether bytes exist, not why they don't.
    """
    if _using_supabase():
        from app.infra.storage_supabase import read_bytes as _read_remote

        return _read_remote(file_path=file_path)

    from app.domain.errors import DomainError

    try:
        path = open_photo(file_path=file_path, upload_dir=upload_dir)
    except DomainError:
        return None
    return path.read_bytes()


def get_evidence_file_path(evidence_id: int) -> str | None:
    from app.extensions import db
    from app.models import ComplaintEvidence

    evidence = db.session.get(ComplaintEvidence, evidence_id)
    return evidence.file_path if evidence else None
