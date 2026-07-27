"""Response helpers shared by every audience package."""

from __future__ import annotations

from app.domain.errors import DomainError


class NotImplementedYet(DomainError):
    """501 — a scaffolded route that has not been built yet.

    Every route in `app/api/` currently raises this. Delete the raise as you
    implement each one; when `grep -rn "todo(" app/api/` comes back empty, the
    HTTP surface is complete.

    It subclasses DomainError so it renders in the same error envelope as
    everything else — a half-built API should still speak the contract's error
    shape, and the frontend running with `VITE_USE_MOCKS=false` should get a
    parseable failure rather than an HTML stack trace.
    """

    http_status = 501
    code = "NOT_IMPLEMENTED"


def todo(what: str) -> None:
    """Mark a route as unbuilt. Call it as the last statement of the view."""
    raise NotImplementedYet(f"{what} is not implemented yet.")
