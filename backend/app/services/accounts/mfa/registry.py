"""One entry per method. Adding email, SMS or WhatsApp codes is a new class and a line here."""

from __future__ import annotations

from app.domain.enums import MfaMethodType
from app.services.accounts.mfa.base import MfaMethod
from app.services.accounts.mfa.totp import TotpMethod

METHODS: dict[MfaMethodType, MfaMethod] = {
    MfaMethodType.TOTP: TotpMethod(),
}
