"""The AI provider protocol and its result types.

There are exactly TWO AI features: photo pre-screening and zone health reports.
Both are advisory, both are background jobs, and NO request path ever waits on
the model.

Category suggestion is deliberately not one of them — the 12 categories are
seeded once and never change, which is precisely the regime where a fixed
lexicon beats a model, so it lives client-side in
`frontend/src/lib/categoryMatcher.ts` with no endpoint and nothing to fail.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ScreenResult:
    """A photo pre-screening verdict. Advisory — an officer still decides."""

    matches_category: bool
    confidence: float
    note: str


@dataclass(frozen=True)
class ReportResult:
    """A generated zone health report."""

    summary: str
    trends: str
    hotspots: str
    suggestions: str


class AiProvider(Protocol):
    """Every implementation returns None on failure. None of them raise.

    That is the contract that makes the fail-soft requirement real: a caller
    that only has to handle `None` cannot forget to handle an exception type it
    has never seen.
    """

    def screen_photo(self, path: str, category: str) -> ScreenResult | None: ...

    def zone_report(self, stats: dict) -> ReportResult | None: ...
