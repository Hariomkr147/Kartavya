from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from flask import Flask

from app.infra.ai.base import ScreenResult
from app.infra.ai.breaker import GuardedProvider
from app.jobs import screening


def _configured_app() -> Flask:
    app = Flask(__name__)
    app.config.update(
        AI_PROVIDER="stub",
        AI_TIMEOUT_SECONDS=1.0,
        AI_BREAKER_FAILURE_THRESHOLD=2,
        AI_BREAKER_COOLDOWN_SECONDS=120,
        AI_WORKER_THREADS=3,
    )
    return app


def test_screening_provider_is_reused_per_application(monkeypatch):
    app = _configured_app()
    provider = object()
    calls = []

    def fake_build_provider(name, **options):
        calls.append((name, options))
        return provider

    monkeypatch.setattr(screening, "build_provider", fake_build_provider)

    assert screening._get_screening_provider(app) is provider
    assert screening._get_screening_provider(app) is provider
    assert calls == [
        (
            "stub",
            {
                "timeout_seconds": 1.0,
                "failure_threshold": 2,
                "cooldown_seconds": 120,
                "executor_workers": 3,
            },
        )
    ]


def test_shared_screening_provider_retains_three_photo_concurrency():
    started = Barrier(3)

    class ConcurrentProvider:
        def screen_photo(self, path, category):
            started.wait(timeout=1)
            return ScreenResult(True, 0.9, path)

        def zone_report(self, stats):  # pragma: no cover - not used by screening
            raise AssertionError

    provider = GuardedProvider(
        ConcurrentProvider(),
        timeout_seconds=2,
        failure_threshold=5,
        cooldown_seconds=120,
        executor_workers=3,
    )

    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(
            executor.map(
                lambda index: provider.screen_photo(str(index), "Pothole"),
                range(3),
            )
        )

    assert [result.note for result in results] == ["0", "1", "2"]


def test_shared_screening_breaker_accumulates_none_failures_across_jobs():
    class UnavailableProvider:
        def __init__(self):
            self.calls = 0

        def screen_photo(self, path, category):
            self.calls += 1
            return None

        def zone_report(self, stats):  # pragma: no cover
            return None

    underlying = UnavailableProvider()
    provider = GuardedProvider(
        underlying,
        timeout_seconds=1,
        failure_threshold=2,
        cooldown_seconds=120,
        executor_workers=3,
    )

    for index in range(5):
        assert provider.screen_photo(f"{index}.png", "Pothole") is None

    # Two failures open the breaker. The remaining three calls are short-circuited.
    assert underlying.calls == 2


def test_guarded_provider_converts_unexpected_exception_to_none():
    class RaisingProvider:
        def __init__(self):
            self.calls = 0

        def screen_photo(self, path, category):
            self.calls += 1
            raise RuntimeError("model crashed")

        def zone_report(self, stats):  # pragma: no cover
            raise RuntimeError("model crashed")

    underlying = RaisingProvider()
    provider = GuardedProvider(
        underlying,
        timeout_seconds=1,
        failure_threshold=5,
        cooldown_seconds=120,
        executor_workers=3,
    )

    # The exception must not escape into the job or endpoint.
    assert provider.screen_photo("photo.png", "Pothole") is None
    assert underlying.calls == 1