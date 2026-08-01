"""The wrapper that makes "AI never breaks the app" structurally true.

Three non-negotiables, all implemented here so no individual provider has to
remember them:

  1. A hard TIMEOUT on every call (5-10 s).
  2. `None` on ANY failure. This wrapper catches everything. No AI exception may
     ever reach a route or a job's error path.
  3. A CIRCUIT BREAKER. After N consecutive failures, short-circuit to None for
     a cooldown window — otherwise a dead model leaves 200 queued photo uploads
     each patiently waiting out its own 10-second timeout.
"""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
from typing import Any

from app.infra.ai.base import AiProvider, ReportResult, ScreenResult

logger = logging.getLogger(__name__)


class CircuitBreaker:
    """Open after `failure_threshold` consecutive failures; retry after `cooldown`."""

    def __init__(self, failure_threshold: int, cooldown_seconds: float) -> None:
        self._failure_threshold = failure_threshold
        self._cooldown_seconds = cooldown_seconds
        self._consecutive_failures = 0
        self._opened_at: float | None = None
        self._lock = threading.Lock()

    def is_open(self) -> bool:
        """True while short-circuiting. Closes itself once the cooldown elapses."""
        with self._lock:
            if self._opened_at is None:
                return False
            if time.monotonic() - self._opened_at >= self._cooldown_seconds:
                self._opened_at = None
                self._consecutive_failures = 0
                return False
            return True

    def record_success(self) -> None:
        with self._lock:
            self._consecutive_failures = 0
            self._opened_at = None

    def record_failure(self) -> None:
        with self._lock:
            self._consecutive_failures += 1
            if self._consecutive_failures >= self._failure_threshold:
                self._opened_at = time.monotonic()
                logger.warning(
                    "AI circuit breaker opened after %d consecutive failures",
                    self._consecutive_failures,
                )


class GuardedProvider:
    """Wraps any AiProvider with the timeout, the catch-all and the breaker.

    Nothing else in the codebase should call a provider directly.
    """

    def __init__(
        self,
        provider: AiProvider,
        *,
        timeout_seconds: float,
        failure_threshold: int,
        cooldown_seconds: float,
    ) -> None:
        self._provider = provider
        self._timeout = timeout_seconds
        self._breaker = CircuitBreaker(failure_threshold, cooldown_seconds)
        # One worker: the timeout needs the call to run somewhere it can be
        # abandoned. Job-level concurrency is the scheduler's pool, not this.
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ai-call")

    def _call(self, method: str, *args: Any) -> Any | None:
        if self._breaker.is_open():
            logger.debug("AI call %s short-circuited: breaker open", method)
            return None
        try:
            future = self._executor.submit(getattr(self._provider, method), *args)
            result = future.result(timeout=self._timeout)
        except FuturesTimeout:
            logger.warning("AI call %s timed out after %.1fs", method, self._timeout)
            self._breaker.record_failure()
            return None
        except Exception:
            # Deliberately bare: the whole point is that no provider failure,
            # of any kind, can reach a caller as an exception.
            logger.exception("AI call %s failed", method)
            self._breaker.record_failure()
            return None
        self._breaker.record_success()
        return result

    def screen_photo(self, path: str, category: str) -> ScreenResult | None:
        return self._call("screen_photo", path, category)

    def zone_report(self, stats: dict) -> ReportResult | None:
        return self._call("zone_report", stats)
