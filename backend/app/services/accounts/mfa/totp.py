"""Authenticator-app codes (RFC 6238), as an `MfaMethod`.

State: `{"secret": <base32>, "last_step": <int>}` — plus the generic keys the
service manages. `last_step` is what makes a used code unusable a second time.
"""

from __future__ import annotations

import secrets
from datetime import datetime
from typing import Any

from app.domain import totp as rules
from app.domain.enums import MfaMethodType
from app.models import User
from app.services.accounts.mfa.base import SetupPrompt

#: Shown in the authenticator app next to the account. Fixed, not a setting.
ISSUER = "Kartavya"


class TotpMethod:
    def begin_setup(self, user: User, now: datetime) -> tuple[dict[str, Any], SetupPrompt]:
        secret = rules.secret_from_bytes(secrets.token_bytes(rules.SECRET_BYTES))
        state = {"secret": secret, "last_step": 0}
        prompt = SetupPrompt(
            method=MfaMethodType.TOTP,
            otpauth_uri=rules.otpauth_uri(secret, user.email, ISSUER),
            secret=secret,
        )
        return state, prompt

    def send_code(self, state: dict[str, Any], now: datetime) -> dict[str, Any]:
        return state  # the user's own app makes the code

    def check(self, state: dict[str, Any], code: str, now: datetime) -> tuple[bool, dict[str, Any]]:
        step = rules.match_step(
            state["secret"], code, int(now.timestamp()), int(state.get("last_step", 0))
        )
        if step is None:
            return False, state
        return True, {**state, "last_step": step}
