"""The PaginationMeta envelope.

Every list response in the contract is `{<key>: [...], pagination: {...}}` —
ComplaintListResponse, FeedListResponse, UserListResponse, ClusterListResponse
and LeaderboardResponse all share the shape, so it is built in exactly one
place.
"""

from __future__ import annotations

from typing import Any

from flask import jsonify

from app.services.queries import Pagination

__all__ = ["Pagination", "paginated"]


def paginated(items: list[Any], pagination: Pagination, key: str = "items"):
    """Wrap a page of already-serialized items in the list envelope."""
    return jsonify({key: items, "pagination": pagination.to_dict()})
