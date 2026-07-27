"""Severity scoring and its bands.

Ported from `frontend/src/mocks/lib/severity.ts`.
"""

from __future__ import annotations

from app.domain.enums import SeverityLabel

#: Lower bound of each band, highest first. LOW is everything below 5.
BANDS: tuple[tuple[int, SeverityLabel], ...] = (
    (30, SeverityLabel.CRITICAL),
    (15, SeverityLabel.HIGH),
    (5, SeverityLabel.MEDIUM),
)


def score(unique_reporter_count: int, upvotes: int) -> int:
    """(distinct citizens - 1) * 3 + upvotes.

    Counts DISTINCT citizens, never raw report count — one person filing the
    same complaint ten times must not be able to inflate its urgency.
    `unique_reporter_count` is 1 for a standalone complaint.

    Two different severity scores use this function with different arguments,
    and mixing them up is invisible:

    | Value                       | unique_reporter_count | upvotes term          |
    |-----------------------------|-----------------------|-----------------------|
    | complaints.severity_score   | its cluster's (or 1)  | *only its own*        |
    | Cluster.severityScore (API) | its own               | total across members  |
    """
    return (unique_reporter_count - 1) * 3 + upvotes


def label(severity_score: int) -> SeverityLabel:
    """Derived on read from the cached score — never stored."""
    for floor, band in BANDS:
        if severity_score >= floor:
            return band
    return SeverityLabel.LOW


def score_range(band: SeverityLabel) -> tuple[int, int | None]:
    """The (inclusive_min, inclusive_max) score range of a band.

    Filtering a list endpoint by `severityLabel` cannot be a plain WHERE on a
    label column — there is no such column. It is a range check against the
    cached `complaints.severity_score`, and this is where that mapping lives so
    every list endpoint filters identically.
    """
    match band:
        case SeverityLabel.CRITICAL:
            return 30, None
        case SeverityLabel.HIGH:
            return 15, 29
        case SeverityLabel.MEDIUM:
            return 5, 14
        case SeverityLabel.LOW:
            return 0, 4
