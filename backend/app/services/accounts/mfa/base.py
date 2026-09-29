"""The contract every two-step method implements.

A method knows only its own maths and its own state. Everything shared —
encryption, lockout, the guarded database write, role policy — lives once in
`service.py`, so a new method cannot get any of it wrong.

`state` is the decrypted JSON dict a method owns (`users.mfa_secret_enc`). The
service adds two generic keys to it (`failed`, `locked_until`) and the method
must leave them alone; its own keys are its business.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from app.domain.enums import MfaMethodType
from app.models import User


@dataclass(frozen=True)
class SetupPrompt:
    """What the client shows to finish enrolling (a QR code and its text form for TOTP)."""

    method: MfaMethodType
    otpauth_uri: str
    secret: str


class MfaMethod(Protocol):
    def begin_setup(self, user: User, now: datetime) -> tuple[dict[str, Any], SetupPrompt]:
        """Fresh state to store as pending, plus what the client should show."""
        ...

    def send_code(self, state: dict[str, Any], now: datetime) -> dict[str, Any]:
        """Deliver a code if this method sends one (email, SMS, WhatsApp).

        Returns the state to store. TOTP has nothing to send and returns the
        state unchanged, which the caller detects and does not write.
        """
        ...

    def check(self, state: dict[str, Any], code: str, now: datetime) -> tuple[bool, dict[str, Any]]:
        """Is `code` right? Also returns the state to store on success (TOTP's newest step)."""
        ...
