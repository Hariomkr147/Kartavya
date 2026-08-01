"""AI access — one adapter that CANNOT raise. Its failure mode is `None`.

Callers see `None` and write `UNAVAILABLE` / `aiAvailable: false`. Never block a
core flow on AI availability, and never let an AI exception reach a route.
"""

from __future__ import annotations

import logging
import threading
from typing import Any

from app.infra.ai.base import AiProvider, ReportResult, ScreenResult
from app.infra.ai.breaker import GuardedProvider
from app.infra.ai.local import LocalModelProvider
from app.infra.ai.null import NullProvider
from app.infra.ai.remote import RemoteApiProvider
from app.infra.ai.stub import StubProvider

__all__ = [
    "AiProvider",
    "GuardedProvider",
    "ReportResult",
    "ScreenResult",
    "build_provider",
    "get_app_provider",
]

logger = logging.getLogger(__name__)

_PROVIDERS = {
    "local": LocalModelProvider,
    "remote": RemoteApiProvider,
    "stub": StubProvider,
    "null": NullProvider,
}

_PROVIDER_CACHE: dict[tuple, GuardedProvider] = {}
_PROVIDER_CACHE_LOCK = threading.Lock()


def build_provider(
    name: str,
    *,
    timeout_seconds: float,
    failure_threshold: int,
    cooldown_seconds: float,
    api_key: str | None = None,
    api_url: str | None = None,
    model_name: str | None = None,
    local_url: str | None = None,
    vision_model: str | None = None,
    text_model: str | None = None,
) -> GuardedProvider:
    """Build the configured provider, already wrapped in its guard."""
    provider_key = name.strip().lower()
    provider_cls = _PROVIDERS.get(provider_key)
    if provider_cls is None:
        logger.warning(
            "Unknown AI_PROVIDER %r; falling back to 'null' (AI features disabled).", name
        )
        provider_cls = NullProvider

    if provider_key == "remote":
        provider_instance = provider_cls(
            api_key=api_key,
            api_url=api_url,
            model_name=model_name,
            timeout_seconds=timeout_seconds,
        )
    elif provider_key == "local":
        provider_instance = provider_cls(
            local_url=local_url,
            vision_model=vision_model,
            text_model=text_model,
            timeout_seconds=timeout_seconds,
        )
    else:
        provider_instance = provider_cls()

    return GuardedProvider(
        provider_instance,
        timeout_seconds=timeout_seconds,
        failure_threshold=failure_threshold,
        cooldown_seconds=cooldown_seconds,
    )


def get_app_provider(app: Any) -> GuardedProvider:
    """Obtain or cache the shared GuardedProvider for the current app configuration.

    Reads AI_PROVIDER, AI_TIMEOUT_SECONDS, AI_BREAKER_FAILURE_THRESHOLD,
    AI_BREAKER_COOLDOWN_SECONDS, and provider endpoints/keys from app.config.
    """
    name = str(app.config.get("AI_PROVIDER", "stub"))
    timeout = float(app.config.get("AI_TIMEOUT_SECONDS", 10.0))
    threshold = int(app.config.get("AI_BREAKER_FAILURE_THRESHOLD", 5))
    cooldown = float(app.config.get("AI_BREAKER_COOLDOWN_SECONDS", 120.0))

    api_key = str(app.config.get("AI_API_KEY", ""))
    api_url = str(app.config.get("AI_API_URL", ""))
    model_name = str(app.config.get("AI_MODEL_NAME", ""))

    local_url = str(app.config.get("AI_LOCAL_URL", ""))
    vision_model = str(app.config.get("AI_LOCAL_VISION_MODEL", ""))
    text_model = str(app.config.get("AI_LOCAL_TEXT_MODEL", ""))

    cache_key = (
        name,
        timeout,
        threshold,
        cooldown,
        api_key,
        api_url,
        model_name,
        local_url,
        vision_model,
        text_model,
    )

    if cache_key not in _PROVIDER_CACHE:
        with _PROVIDER_CACHE_LOCK:
            if cache_key not in _PROVIDER_CACHE:
                _PROVIDER_CACHE[cache_key] = build_provider(
                    name,
                    timeout_seconds=timeout,
                    failure_threshold=threshold,
                    cooldown_seconds=cooldown,
                    api_key=api_key,
                    api_url=api_url,
                    model_name=model_name,
                    local_url=local_url,
                    vision_model=vision_model,
                    text_model=text_model,
                )
    return _PROVIDER_CACHE[cache_key]
