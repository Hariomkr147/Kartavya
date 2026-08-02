"""Serialization context shared between services and API serializers."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class SerializationContext:
    """Pre-fetched batch data passed to serializers so they never query."""

    now: datetime
    categories: dict[int, Any] = field(default_factory=dict)
    zones: dict[int, Any] = field(default_factory=dict)
    upvote_counts: dict[int, int] = field(default_factory=dict)
    first_evidence: dict[int, Any] = field(default_factory=dict)
    evidence_rows: dict[int, list[Any]] = field(default_factory=dict)
    history_rows: dict[int, list[Any]] = field(default_factory=dict)
    note_rows: dict[int, list[Any]] = field(default_factory=dict)
