"""Neutral response shapes — the ones every audience reuses.

Two hard rules:

1. **Serializers never query.** They receive everything pre-loaded through a
   `SerializationContext`. This keeps privacy decisions visible in one place and
   stops a 20-item page from becoming 60 queries.
2. **These shapes have NO reporter field at all** — structurally, not by
   stripping it afterwards. The officer queue, the public feed and cluster
   details all reuse them, so there is nothing here to accidentally leak.

Only `app/api/admin/serializers.py` may ever emit reporter identity.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.models import Complaint, ComplaintCategory, Zone


@dataclass
class SerializationContext:
    """Everything the serializers need, gathered once by the caller.

    The service builds this; the serializer only reads it. `now` is passed in so
    derived SLA labels are consistent across a whole page — computing
    `datetime.now()` per item would let the first and last row of one response
    disagree about what time it is.
    """

    now: datetime
    categories: dict[int, ComplaintCategory] = field(default_factory=dict)
    zones: dict[int, Zone] = field(default_factory=dict)
    #: complaint_id -> COUNT(*), from ONE GROUP BY.
    upvote_counts: dict[int, int] = field(default_factory=dict)
    #: complaint_id -> first evidence row, for `photoUrl`.
    first_evidence: dict[int, Any] = field(default_factory=dict)


def serialize_complaint(complaint: Complaint, ctx: SerializationContext) -> dict[str, Any]:
    """The compact `Complaint` shape (openapi.yaml: Complaint). TODO(phase 3).

    Derived on read, never stored:
      * `severityLabel` <- `domain.severity.label(complaint.severity_score)`
      * `slaLabel`      <- `domain.sla.label(...)` over the four sla_* columns
      * `upvoteCount`   <- ctx.upvote_counts
      * `photoUrl`      <- `core.signing.sign_photo_url(evidence.id)`, NEVER the
        raw file_path. This is the one place a photo URL is minted, and it is
        minted here precisely because scoping has already decided this caller
        may see the parent complaint.

    Do not add a `reporter` key. Not "temporarily", not "for debugging".
    """
    raise NotImplementedError


def serialize_complaint_detail(complaint: Complaint, ctx: SerializationContext) -> dict[str, Any]:
    """`ComplaintDetail` — the compact shape plus evidence, history and notes.

    TODO(phase 3). Progress notes carry `officerId`, never an officer name.
    """
    raise NotImplementedError


def serialize_category(category: ComplaintCategory) -> dict[str, Any]:
    """`Category`. Note the field renames: category_code -> `code`,
    sla_hours -> `slaTargetHours`. TODO(phase 2).
    """
    raise NotImplementedError


def serialize_zone(zone: Zone) -> dict[str, Any]:
    """`Zone`. TODO(phase 2)."""
    raise NotImplementedError


def serialize_evidence(evidence: Any, ctx: SerializationContext) -> dict[str, Any]:
    """`Evidence`, including the AiConfidenceNote.

    TODO(phase 3). `aiAvailable` is `ai_screen_status != UNAVAILABLE` — the UI
    uses it to tell "no result yet" apart from "the model was down", so do not
    collapse the two.
    """
    raise NotImplementedError


def serialize_status_history(entry: Any) -> dict[str, Any]:
    """`StatusHistoryEntry`. TODO(phase 3).

    `changedByOfficerId` is `changed_by_user_id` ONLY when actor_role is
    OFFICER. For CITIZEN and ADMIN entries it stays absent — a citizen must not
    learn which admin ruled on their dispute, and an officer must not learn
    which citizen filed.
    """
    raise NotImplementedError


def masked_display_name(user: Any) -> str:
    """`display_name`, or a masked fallback like "Citizen #1042".

    TODO(phase 2). The fallback is NEVER `full_name`. That column is visible
    only on GET /users/me (self) and in admin views.
    """
    raise NotImplementedError
