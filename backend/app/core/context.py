"""Serialization context shared between services and API serializers."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.models.accounts import ComplaintCategory, Zone


@dataclass
class SerializationContext:
    """Pre-fetched batch data passed to serializers so they never query."""

    now: datetime
    categories: dict[int, ComplaintCategory] = field(default_factory=dict)
    zones: dict[int, Zone] = field(default_factory=dict)
    upvote_counts: dict[int, int] = field(default_factory=dict)
    first_evidence: dict[int, Any] = field(default_factory=dict)
