"""RFC 6238 time-based one-time passwords — the maths and nothing else.

Pure on purpose: no clock, no randomness, no I/O. `now` arrives as a number and
the secret's random bytes arrive as an argument, so every rule here runs in
microseconds and is checked against the RFC's own test vectors in
`tests/domain/test_totp.py`.

Parameters are the ones every authenticator app assumes and cannot be changed
per account: HMAC-SHA1, 30-second steps, 6 digits. (SHA-1 is fine here — HMAC
does not have the collision weakness of bare SHA-1, and Google Authenticator
and its peers ignore any other algorithm in the URI.)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import struct
from urllib.parse import quote

STEP_SECONDS = 30
DIGITS = 6
#: Codes from one step either side of "now" are accepted, to absorb clock drift
#: between the server and the phone.
WINDOW = 1
#: 20 random bytes = the 160-bit key HMAC-SHA1 is designed around (RFC 4226 §4).
SECRET_BYTES = 20


def secret_from_bytes(raw: bytes) -> str:
    """Base32 text of `raw`, unpadded — what authenticator apps expect to read."""
    return base64.b32encode(raw).decode("ascii").rstrip("=")


def step_at(unix_seconds: int) -> int:
    """The 30-second counter a moment falls in."""
    return unix_seconds // STEP_SECONDS


def code_for_step(secret: str, step: int, digits: int = DIGITS) -> str:
    """The code for one counter value (RFC 4226 HOTP with dynamic truncation)."""
    key = base64.b32decode(secret.upper() + "=" * (-len(secret) % 8))
    mac = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    value = struct.unpack(">I", mac[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**digits).zfill(digits)


def match_step(secret: str, code: str, unix_seconds: int, last_step: int) -> int | None:
    """The step `code` is valid for, or None.

    `last_step` is the newest step already accepted for this secret. Anything at
    or before it is refused, which is what stops a code that was shoulder-surfed
    or intercepted a moment ago from being used a second time inside its window.
    """
    if len(code) != DIGITS or not (code.isascii() and code.isdigit()):
        return None
    now_step = step_at(unix_seconds)
    matched: int | None = None
    # Check every candidate (no early exit) so timing does not reveal which one hit.
    for step in range(now_step - WINDOW, now_step + WINDOW + 1):
        if hmac.compare_digest(code_for_step(secret, step), code) and step > last_step:
            matched = step
    return matched


def otpauth_uri(secret: str, account: str, issuer: str) -> str:
    """The `otpauth://` URI a QR code carries (Google's key-uri format)."""
    label = f"{quote(issuer, safe='')}:{quote(account, safe='')}"
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer, safe='')}"
