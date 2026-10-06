"""The five error types every layer raises, and nothing else raises.

Services raise these; `app/core/errors.py` renders them as the one error
envelope the contract defines and the frontend already parses:

    {"error": {"code": ..., "message": ..., "details": [...]}}

Routes contain no try/except at all — see docs/backend/architecture.md Part 8.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ErrorDetail:
    """One entry of the optional `details` array — a per-field complaint."""

    field: str
    issue: str

    def to_dict(self) -> dict[str, str]:
        return {"field": self.field, "issue": self.issue}


class DomainError(Exception):
    """Base class. `http_status` and `code` are what core/errors.py renders."""

    http_status: int = 500
    code: str = "INTERNAL_ERROR"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        details: list[ErrorDetail] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        self.details: list[ErrorDetail] = details or []


class ValidationError(DomainError):
    """400 — the request itself is malformed or internally inconsistent."""

    http_status = 400
    code = "VALIDATION_ERROR"


class AuthError(DomainError):
    """401 — no token, bad token, expired token, or a deactivated account."""

    http_status = 401
    code = "UNAUTHORIZED"


class ForbiddenError(DomainError):
    """403 — authenticated, but the wrong role or the wrong zone.

    Also the answer for a bad photo-URL signature: never 404, or evidence IDs
    become enumerable.
    """

    http_status = 403
    code = "FORBIDDEN"


class NotFoundError(DomainError):
    """404 — no such row, or one this caller is not allowed to know exists."""

    http_status = 404
    code = "NOT_FOUND"


class ConflictError(DomainError):
    """409 — the request is well-formed but illegal in the current state.

    Always carries its own code: INVALID_TRANSITION, EMAIL_TAKEN,
    ALREADY_UPVOTED, ZONE_IN_USE, ... — the frontend switches on it.
    """

    http_status = 409
    code = "CONFLICT"

    def __init__(
        self,
        code: str,
        message: str,
        *,
        details: list[ErrorDetail] | None = None,
    ) -> None:
        super().__init__(message, code=code, details=details)


class TooManyRequestsError(DomainError):
    """429 — a rate limit or lockout. Carries its own code (MFA_LOCKED, ...)."""

    http_status = 429
    code = "TOO_MANY_REQUESTS"


class ServiceUnavailableError(DomainError):
    """503 — an optional feature is switched off or cannot run right now.

    Used when a setting the feature needs is absent (MFA_NOT_CONFIGURED,
    GOOGLE_NOT_CONFIGURED). The rest of the API is unaffected — that is the
    whole reason these are 503s and not startup failures.
    """

    http_status = 503
    code = "SERVICE_UNAVAILABLE"


@dataclass(frozen=True)
class Ok:
    """A rule check that passed."""

    ok: bool = field(default=True, init=False)


@dataclass(frozen=True)
class Err:
    """A rule check that failed, as a value rather than an exception.

    The domain returns these instead of raising because
    `POST /officer/complaints/batch-status` needs a per-item failure code for
    up to 100 complaints in one 200 response. Exceptions would force one
    try/except per item and flatten the structure the contract asks for.

    Services translate an `Err` into the matching `DomainError` on the
    single-item paths — see `raise_for()`.
    """

    code: str
    message: str
    http_status: int = 409
    ok: bool = field(default=False, init=False)


Check = Ok | Err


def raise_for(result: Check) -> None:
    """Turn a failed check into the exception the single-item doors want.

    No-op when the check passed, so a service can write:

        raise_for(validate_officer_transition(current, target, reason))
    """
    if isinstance(result, Ok):
        return
    if result.http_status == 400:
        raise ValidationError(result.message, code=result.code)
    if result.http_status == 403:
        raise ForbiddenError(result.message, code=result.code)
    if result.http_status == 404:
        raise NotFoundError(result.message, code=result.code)
    raise ConflictError(result.code, result.message)
