"""Photo validation and filesystem writes.

UPLOAD_DIR sits OUTSIDE the web root and is never registered as a static
directory. The only way an image leaves this server is the signed route
`GET /evidence/{id}/photo`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

#: The first bytes of each format we accept. Checked instead of Content-Type,
#: which the client controls and can simply lie about.
MAGIC_BYTES: dict[str, bytes] = {
    "image/jpeg": b"\xff\xd8\xff",
    "image/png": b"\x89PNG\r\n\x1a\n",
}


def detect_mime_type(head: bytes) -> str | None:
    """Identify a file from its first bytes, or None if we do not accept it."""
    for mime, prefix in MAGIC_BYTES.items():
        if head.startswith(prefix):
            return mime
    return None


def validate_photo(*, stream: Any, declared_mime: str | None, max_bytes: int) -> str:
    """Validate one upload. Returns the detected MIME type.

    Checks:
      1. MAGIC BYTES, not the Content-Type header.
      2. Size <= max_bytes.
    """
    from app.domain.errors import ValidationError

    if stream is None:
        raise ValidationError("Photo file is required.")

    # Reset position if possible
    if hasattr(stream, "seek"):
        stream.seek(0)

    # Read head for magic bytes
    head = stream.read(16)
    mime_type = detect_mime_type(head) if head else None

    if not mime_type:
        raise ValidationError("Invalid photo format. Only JPEG and PNG images are allowed.")

    # Read total content length
    if hasattr(stream, "seek"):
        stream.seek(0, 2)
        total_size = stream.tell()
        stream.seek(0)
    else:
        # If not seekable, length is length of head if no more or read all
        rest = stream.read()
        total_size = len(head) + len(rest)

    if total_size <= 0:
        raise ValidationError("Photo file is empty.")

    if total_size > max_bytes:
        raise ValidationError(f"Photo file exceeds maximum size of {max_bytes // (1024 * 1024)}MB.")

    return mime_type


def store_photo(*, complaint_id: int, stream: Any, mime_type: str, upload_dir: Path) -> str:
    """Write the file and return the RELATIVE path for complaint_evidence.file_path."""
    import uuid

    ext = ".jpg" if mime_type == "image/jpeg" else ".png"
    filename = f"{uuid.uuid4()}{ext}"

    complaint_dir = upload_dir / str(complaint_id)
    complaint_dir.mkdir(parents=True, exist_ok=True)

    file_path = complaint_dir / filename

    if hasattr(stream, "seek"):
        stream.seek(0)

    if hasattr(stream, "save"):
        stream.save(str(file_path))
    else:
        content = stream.read()
        with open(file_path, "wb") as f:
            f.write(content)

    return f"{complaint_id}/{filename}"


def open_photo(*, file_path: str, upload_dir: Path) -> Path:
    """Resolve a stored path for serving, refusing anything outside UPLOAD_DIR."""
    from app.domain.errors import ForbiddenError, NotFoundError

    resolved_upload_dir = upload_dir.resolve()
    target_path = (upload_dir / file_path).resolve()

    try:
        target_path.relative_to(resolved_upload_dir)
    except ValueError as err:
        raise ForbiddenError("Invalid file path.") from err

    if not target_path.exists() or not target_path.is_file():
        raise NotFoundError("Photo file not found.")

    return target_path


def get_evidence_file_path(evidence_id: int) -> str | None:
    """Retrieve relative file path for evidence row without DB access in route handlers."""
    from app.extensions import db
    from app.models import ComplaintEvidence

    ev = db.session.get(ComplaintEvidence, evidence_id)
    return ev.file_path if ev else None
