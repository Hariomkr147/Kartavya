"""Supabase Storage backend for photo evidence.

Selected by `STORAGE_PROVIDER=supabase` and dispatched to from
`app/infra/storage.py`, which is the only module anything outside `app/infra/`
imports — callers never know which backend is active.

Talks to the Storage REST API directly over `urllib`, the same way
`app/infra/ai/local.py` and `app/infra/ai/remote.py` talk to their model
endpoints, rather than pulling in the `supabase-py` SDK (httpx + gotrue +
postgrest + realtime + storage3) for three HTTP calls.

Every request authenticates with the service_role key, which bypasses the
bucket's Row Level Security entirely. That is what makes this safe to use
against a PRIVATE bucket: access control is enforced upstream by our own
HMAC-signed photo URLs (`app/core/signing.py`), not by a Supabase policy, so
the bucket must stay private — a public bucket would let anyone who guesses an
object key skip the signature check entirely.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any
from uuid import uuid4

from flask import current_app

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 30


def _config() -> tuple[str, str, str]:
    """Return (base_url, service_role_key, bucket), or raise if unconfigured.

    `app/settings.py` already fails fast at startup in production if these are
    missing; this is the second guard for anyone constructing a config by hand
    (tests, a script) with STORAGE_PROVIDER=supabase but no credentials.
    """
    cfg = current_app.config
    base_url = cfg.get("SUPABASE_URL", "")
    key = cfg.get("SUPABASE_SERVICE_ROLE_KEY", "")
    bucket = cfg.get("SUPABASE_STORAGE_BUCKET", "evidence-photos")
    if not base_url or not key:
        raise RuntimeError(
            "STORAGE_PROVIDER=supabase requires SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY to be set."
        )
    return base_url, key, bucket


def _headers(key: str, content_type: str | None = None) -> dict[str, str]:
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def _object_url(base_url: str, bucket: str, object_key: str) -> str:
    return f"{base_url}/storage/v1/object/{bucket}/{object_key}"


def store_photo(*, complaint_id: int, stream: Any, mime_type: str) -> str:
    """Upload one photo and return its object key (mirrors local storage's relative path).

    The key shape — `<complaint_id>/<uuid>.<ext>` — matches the local backend
    on purpose: `file_path` is an opaque string to every caller regardless of
    which backend wrote it (screening derives the extension from it; nothing
    parses the complaint_id segment back out).
    """
    base_url, key, bucket = _config()
    extension = ".jpg" if mime_type == "image/jpeg" else ".png"
    object_key = f"{complaint_id}/{uuid4().hex}{extension}"

    stream.seek(0)
    data = stream.read()
    stream.seek(0)

    req = urllib.request.Request(
        _object_url(base_url, bucket, object_key),
        data=data,
        headers={**_headers(key, mime_type), "x-upsert": "true"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_SECONDS) as resp:
            resp.read()
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", errors="ignore")
        logger.error("Supabase Storage upload failed (%d): %s", err.code, body)
        raise RuntimeError(f"Supabase Storage upload failed: HTTP {err.code}") from err
    except urllib.error.URLError as err:
        logger.error("Supabase Storage unreachable during upload: %s", err)
        raise RuntimeError("Supabase Storage is unreachable.") from err

    return object_key


def read_bytes(*, file_path: str) -> bytes | None:
    """Download one object's bytes, or None if it cannot be served.

    Mirrors `open_photo`'s local-backend contract: every failure — missing
    object, unreachable service, bad credentials — returns None rather than
    raising, because the caller (the signed photo route, or AI screening) must
    treat "can't serve this" as one outcome, not a menu of exception types.
    """
    base_url, key, bucket = _config()
    req = urllib.request.Request(
        _object_url(base_url, bucket, file_path),
        headers=_headers(key),
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_SECONDS) as resp:
            return resp.read()
    except urllib.error.HTTPError as err:
        if err.code != 404:
            logger.error("Supabase Storage download failed (%d) for %s", err.code, file_path)
        return None
    except urllib.error.URLError:
        logger.exception("Supabase Storage unreachable while reading %s", file_path)
        return None


def remove_photo(*, file_path: str) -> None:
    """Best-effort delete — never raises. Mirrors the local backend's contract:

    cleanup after a rolled-back upload, or a lifecycle transition removing
    older evidence, must not itself fail the request that triggered it.
    """
    try:
        base_url, key, bucket = _config()
    except RuntimeError:
        logger.exception("Supabase Storage not configured; skipping delete of %s", file_path)
        return

    body = json.dumps({"prefixes": [file_path]}).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/storage/v1/object/{bucket}",
        data=body,
        headers=_headers(key, "application/json"),
        method="DELETE",
    )
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_SECONDS) as resp:
            resp.read()
    except Exception:
        logger.exception(
            "Supabase Storage delete failed for %s (best-effort, continuing)", file_path
        )
