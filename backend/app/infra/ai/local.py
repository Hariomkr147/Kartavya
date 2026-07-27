"""The real local model.

TODO(phase 8). Both methods may raise, block, or return nonsense — that is fine
and expected. `GuardedProvider` is what turns any of those into a clean `None`,
so nothing in here needs its own try/except or its own timeout.

Keep the model handle lazy: loading weights at import time would make
`flask shell`, the test suite and every CLI command pay for a model nobody asked
for.
"""

from __future__ import annotations

from app.infra.ai.base import ReportResult, ScreenResult


class LocalModelProvider:
    def __init__(self, **options: object) -> None:
        self._options = options
        self._model = None  # loaded on first use

    def screen_photo(self, path: str, category: str) -> ScreenResult | None:
        """Vision model: does this photo look like the category the citizen picked?

        TODO(phase 8). The result is ADVISORY. It populates
        `complaint_evidence.ai_matches_category` / `ai_confidence` / `ai_note`
        as a hint for the officer, and must never auto-reject anything: a
        rejection costs a real citizen 20 points.
        """
        raise NotImplementedError

    def zone_report(self, stats: dict) -> ReportResult | None:
        """Text model: turn a zone's aggregate statistics into a written report.

        TODO(phase 8). `stats` is pre-aggregated by
        `services/analytics/zone.py` — pass numbers to the model, never raw
        rows, and never anything that identifies a reporter.
        """
        raise NotImplementedError
