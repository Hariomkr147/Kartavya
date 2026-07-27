"""Upvotes — one per citizen per complaint, never on your own.

An upvote has two effects: +1 to the complaint's severity score, and +5 CSP to
the REPORTER (not the voter).
"""

from __future__ import annotations

from datetime import datetime

from app.models import User


def upvote(*, complaint_id: int, citizen: User, now: datetime) -> dict[str, int]:
    """POST /complaints/{id}/upvote -> UpvoteResult {upvoteCount, severityScore}.

    TODO(phase 6). One transaction:
      1. 409 ALREADY_UPVOTED if this citizen already upvoted it. Check first
         rather than catching the unique-index IntegrityError, so the response
         is a clean contract error rather than a 500.
      2. 409 (or 400) if `citizen.id == complaint.citizen_id` — no self-upvotes.
      3. Insert the `complaint_upvotes` row.
      4. Credit UPVOTE_RECEIVED (+5) to the complaint's REPORTER.
      5. `clusters.recompute_severity_for_cluster(...)` — an upvote changes only
         this complaint's own score, but the cluster's API-level severity is
         computed from the members' totals, so recompute through the same path.
      6. Re-evaluate the reporter's badges.

    Returns the new count and score for the response body.
    """
    raise NotImplementedError


def upvote_counts(*, complaint_ids: list[int]) -> dict[int, int]:
    """COUNT(*) per complaint, in ONE GROUP BY.

    TODO(phase 3). Serializers must not query, so list endpoints prefetch this
    and hand it to the serializer. Without it a 20-item page becomes 20 extra
    queries — and `GET /feed` and the officer queue serialize a full page on
    every call.
    """
    raise NotImplementedError
