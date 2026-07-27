"""Signed, expiring photo URLs.

A browser `<img>` tag cannot send an `Authorization` header, and every photo in
the finished frontend is a plain `<img src={photoUrl}>`. Rather than force every
image through a fetch-and-blob detour, the server signs: by the time a
serializer runs, the read-side scoping has *already* decided this caller may see
the parent complaint, and the signature is just that decision made portable.

Three rules the whole design rests on:

1. Only a serializer mints a URL — never a route, never a service.
2. The photo route verifies the signature and nothing else: no JWT, no session,
   no zone lookup. `security: []` in the contract is deliberate.
3. It answers 403 for a bad signature AND for a missing evidence row alike.
   A 404 would let anyone enumerate which evidence IDs exist.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time

from flask import current_app

from app.domain.errors import ForbiddenError
from app.settings import API_PREFIX


def _signature(evidence_id: int, exp: int, key: str) -> str:
    raw = f"{evidence_id}|{exp}".encode()
    digest = hmac.new(key.encode(), raw, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def sign_photo_url(evidence_id: int, ttl_seconds: int | None = None) -> str:
    """Mint a fresh link. Called at serialization time, on every read.

    Because links are re-minted every time, ordinary navigation never sees a
    broken image — but nothing shareable outlives its window either.
    """
    ttl = ttl_seconds or current_app.config["PHOTO_URL_TTL_SECONDS"]
    exp = int(time.time()) + int(ttl)
    sig = _signature(evidence_id, exp, current_app.config["PHOTO_SIGNING_KEY"])
    return f"{API_PREFIX}/evidence/{evidence_id}/photo?exp={exp}&sig={sig}"


def verify_photo_signature(evidence_id: int, exp: str | None, sig: str | None) -> int:
    """Validate a photo link. Returns the remaining TTL in seconds.

    That return value is not decoration: the route sets
    `Cache-Control: private, max-age=<remaining>` from it, so the browser caches
    the image exactly as long as the link is valid, and no shared proxy caches
    it at all.

    Raises ForbiddenError — never NotFoundError — for every failure mode.
    """
    if not exp or not sig:
        raise ForbiddenError("This photo link is not valid.")
    try:
        expires_at = int(exp)
    except ValueError as err:
        raise ForbiddenError("This photo link is not valid.") from err

    now = int(time.time())
    if expires_at <= now:
        raise ForbiddenError("This photo link has expired.")

    expected = _signature(evidence_id, expires_at, current_app.config["PHOTO_SIGNING_KEY"])
    # compare_digest, not ==: a plain comparison leaks the signature one byte at
    # a time through its timing.
    if not hmac.compare_digest(expected, sig):
        raise ForbiddenError("This photo link is not valid.")

    return expires_at - now
