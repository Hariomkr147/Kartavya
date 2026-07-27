"""AI access — one adapter that CANNOT raise. Its failure mode is `None`.

Callers see `None` and write `UNAVAILABLE` / `aiAvailable: false`. Never block a
core flow on AI availability, and never let an AI exception reach a route.
"""

from __future__ import annotations

import logging

from app.infra.ai.base import AiProvider, ReportResult, ScreenResult
from app.infra.ai.breaker import GuardedProvider
from app.infra.ai.local import LocalModelProvider
from app.infra.ai.null import NullProvider
from app.infra.ai.stub import StubProvider

__all__ = [
    "AiProvider",
    "GuardedProvider",
    "ReportResult",
    "ScreenResult",
    "build_provider",
]

logger = logging.getLogger(__name__)

_PROVIDERS = {
    "local": LocalModelProvider,
    "stub": StubProvider,
    "null": NullProvider,
}


def build_provider(
    name: str,
    *,
    timeout_seconds: float,
    failure_threshold: int,
    cooldown_seconds: float,
) -> GuardedProvider:
    """Build the configured provider, already wrapped in its guard.

    There is deliberately no way to obtain an unguarded provider.

    An unknown name falls back to `null` with a warning rather than refusing to
    start: a typo in AI_PROVIDER must not take the application down, since the
    application is required to work with no AI at all.
    """
    provider_cls = _PROVIDERS.get(name.strip().lower())
    if provider_cls is None:
        logger.warning(
            "Unknown AI_PROVIDER %r; falling back to 'null' (AI features disabled).", name
        )
        provider_cls = NullProvider

    return GuardedProvider(
        provider_cls(),
        timeout_seconds=timeout_seconds,
        failure_threshold=failure_threshold,
        cooldown_seconds=cooldown_seconds,
    )
