"""Encrypts small JSON blobs at rest — the 2FA secrets in `users.mfa_secret_enc`.

Fernet (AES-128-CBC + HMAC-SHA256, from `cryptography`), through `MultiFernet` so
a key can be rotated: `MFA_ENCRYPTION_KEY` may hold several keys, comma-
separated. The first encrypts; any of them decrypts. To rotate, put the new key
first, deploy, run `rotate_all` (or just wait — secrets are re-sealed the next
time they are written), then drop the old key.

With no key configured, two-step verification is simply off: `seal` and
`unseal` raise a 503 that names the setting, and nothing else in the app is
affected. Losing the key makes every stored secret unreadable, which is what
`flask --app app reset-mfa` and the admin reset are for.
"""

from __future__ import annotations

import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from flask import current_app

from app.domain.errors import ServiceUnavailableError


def _keys() -> list[str]:
    raw = current_app.config.get("MFA_ENCRYPTION_KEY", "") or ""
    return [k.strip() for k in raw.split(",") if k.strip()]


def is_configured() -> bool:
    return bool(_keys())


def _box() -> MultiFernet:
    keys = _keys()
    if not keys:
        raise ServiceUnavailableError(
            "Two-step verification is not set up on this server.", code="MFA_NOT_CONFIGURED"
        )
    return MultiFernet([Fernet(key) for key in keys])


def require_configured() -> None:
    _box()


def seal(state: dict[str, Any]) -> str:
    return _box().encrypt(json.dumps(state, separators=(",", ":")).encode()).decode("ascii")


def unseal(blob: str) -> dict[str, Any]:
    try:
        return json.loads(_box().decrypt(blob.encode("ascii")))
    except (InvalidToken, ValueError) as exc:
        # A key that changed without rotation, or a damaged row. Say so without
        # detail; an admin reset (or the CLI) clears it.
        raise ServiceUnavailableError(
            "Two-step verification is unavailable for this account. "
            "Ask an administrator to reset it.",
            code="MFA_STATE_UNREADABLE",
        ) from exc
