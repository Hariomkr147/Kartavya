"""Endpoints available to more than one audience.

Clusters and zone summaries are officer + admin. The photo route is authorized
by its URL signature rather than by a header, which is a different mechanism
from everything else in the system — see `core/signing.py`.
"""

from __future__ import annotations

from flask import Blueprint, request

from app.api.shared.responses import todo
from app.core.auth import require_role
from app.domain.enums import UserRole

bp = Blueprint("shared", __name__)

OFFICER = UserRole.OFFICER
ADMIN = UserRole.ADMIN


@bp.get("/clusters")
@require_role(OFFICER, ADMIN)
def get_clusters():
    """200 ClusterListResponse.

    TODO(phase 5). Officers see their own zone only (`scoping.visible_clusters`).

    A cluster's `severityScore` uses the TOTAL upvotes across all members, while
    each member complaint's own score uses only its own. Same formula, different
    argument — passing the wrong total is invisible in review.
    """
    todo("Cluster list")


@bp.get("/clusters/<cluster_id>")
@require_role(OFFICER, ADMIN)
def get_cluster_by_id(cluster_id: str):
    """200 ClusterDetail.

    TODO(phase 5). `statusSummary` is DERIVED from the members' current
    statuses — a cluster holding members at mixed stages is normal, not a bug.
    Members reuse the compact Complaint shape, so no reporter identity appears.
    """
    todo("Cluster detail")


@bp.get("/zones/<zone_id>/summary")
@require_role(OFFICER, ADMIN)
def get_zone_summary(zone_id: str):
    """200 ZoneSummary.

    TODO(phase 5). An officer may summarise only their OWN zone —
    `core.scoping.assert_can_view_zone`.
    """
    todo("Zone summary")


@bp.get("/evidence/<int:evidence_id>/photo")
def get_evidence_photo(evidence_id: int):
    """200 image/jpeg|png. PUBLIC (`security: []`) — authorized by signature.

    TODO(phase 3). This route is deliberately unusual, and the three rules are
    the whole design:

      1. It verifies the SIGNATURE AND NOTHING ELSE. No JWT, no session, no zone
         lookup — the check already happened when a serializer decided this
         caller could see the parent complaint and minted the link. A browser
         `<img>` tag cannot carry a bearer token; the signature carries that
         earlier verdict instead.
      2. It answers 403 for a bad signature AND for a missing evidence row
         ALIKE. A 404 would let anyone enumerate which evidence IDs exist.
      3. Set `Cache-Control: private, max-age=<remaining TTL>` from
         `verify_photo_signature`'s return value, so the browser caches the
         image exactly as long as the link is valid and no shared proxy caches
         it at all.

    Serve with `send_file` from UPLOAD_DIR, which sits outside the web root and
    is never registered as a static directory.
    """
    _exp = request.args.get("exp")
    _sig = request.args.get("sig")
    # verify_photo_signature(evidence_id, _exp, _sig) -> remaining TTL seconds
    todo("Evidence photo")
