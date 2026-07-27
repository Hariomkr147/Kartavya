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

    TODO(phase 3). Checks, in this order:
      1. MAGIC BYTES, not the `Content-Type` header. A client controls that
         header; a `.php` renamed to `.jpg` with an `image/jpeg` header is the
         attack this closes.
      2. Size <= MAX_UPLOAD_BYTES (5 MB). Check the actual stream length, not
         the declared `Content-Length`.

    Raises ValidationError with a useful message on either failure.
    """
    raise NotImplementedError


def store_photo(*, complaint_id: int, stream: Any, mime_type: str, upload_dir: Path) -> str:
    """Write the file and return the RELATIVE path for `complaint_evidence.file_path`.

    TODO(phase 3). Layout: `UPLOAD_DIR/<complaint_id>/<uuid>.<ext>`.

    Never store the client's filename — that is the path-traversal hole
    (`../../etc/...`), and a UUID also stops one upload overwriting another.
    Never store image bytes in SQLite.
    """
    raise NotImplementedError


def open_photo(*, file_path: str, upload_dir: Path) -> Path:
    """Resolve a stored path for serving, refusing anything outside UPLOAD_DIR.

    TODO(phase 3). Resolve both paths and confirm the result is genuinely under
    `upload_dir` before opening it. Even though `file_path` comes from our own
    database, a traversal bug elsewhere should not become a file-read primitive
    here.
    """
    raise NotImplementedError
