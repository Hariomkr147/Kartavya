"""Which roles are nudged to turn on two-step verification.

Nothing is enforced. Two-step verification is open to every role; this only
decides who sees the "recommended" banner. Keeping it in one pure function
means making it mandatory for admins later is a one-line change here, not a
redesign of login.
"""

from __future__ import annotations

from app.domain.enums import MfaPolicy, UserRole

_RECOMMENDED = frozenset({UserRole.ADMIN, UserRole.OFFICER})


def mfa_policy(role: UserRole) -> MfaPolicy:
    return MfaPolicy.RECOMMENDED if role in _RECOMMENDED else MfaPolicy.OPTIONAL
