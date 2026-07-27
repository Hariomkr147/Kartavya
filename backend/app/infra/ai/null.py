"""Always unavailable. Use it to test every fail-soft path.

Running the whole test suite against this provider is the cheapest way to prove
the app genuinely keeps working with the model down — which the contract
requires, and which is easy to believe without ever checking.
"""

from __future__ import annotations

from app.infra.ai.base import ReportResult, ScreenResult


class NullProvider:
    def screen_photo(self, path: str, category: str) -> ScreenResult | None:
        return None

    def zone_report(self, stats: dict) -> ReportResult | None:
        return None
