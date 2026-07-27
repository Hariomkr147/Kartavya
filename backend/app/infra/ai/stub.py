"""Canned, deterministic results — the default for development and CI.

Deterministic on purpose: a screening result that varies between runs makes
every test that touches evidence flaky, and the AI's actual answer is never what
those tests are about.
"""

from __future__ import annotations

from app.infra.ai.base import ReportResult, ScreenResult


class StubProvider:
    def screen_photo(self, path: str, category: str) -> ScreenResult | None:
        return ScreenResult(
            matches_category=True,
            confidence=0.82,
            note=f"The photo appears consistent with the {category} category.",
        )

    def zone_report(self, stats: dict) -> ReportResult | None:
        return ReportResult(
            summary="Complaint volume is steady, with resolution times inside target.",
            trends="Potholes and streetlight faults dominate; both are trending flat.",
            hotspots="A cluster of drainage complaints near the market junction.",
            suggestions="Schedule a joint drainage inspection before the monsoon.",
        )
