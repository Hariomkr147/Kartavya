"""Endpoints available to more than one audience.

Clusters and zone summaries are officer + admin. The photo route is authorized
by its URL signature rather than by a header, which is a different mechanism
from everything else in the system — see `core/signing.py`.

Like every other route module, nothing here touches `db.session`: the reads live
in `services/complaints/cluster_reads.py` and `services/analytics/zone.py`.
"""

from __future__ import annotations

from datetime import UTC, datetime

from flask import Blueprint, current_app, jsonify, request, send_file

from app.api.shared.schemas import ClusterListQuery
from app.api.shared.serializers import serialize_cluster, serialize_cluster_detail
from app.core import scoping
from app.core.auth import current_user, require_role
from app.core.signing import verify_photo_signature
from app.core.validation import validate_query
from app.domain.enums import UserRole
from app.domain.errors import ForbiddenError
from app.services.analytics.zone import zone_summary
from app.services.complaints.cluster_reads import list_clusters, load_cluster
from app.services.complaints.evidence import photo_for_signed_request

bp = Blueprint("shared", __name__)

OFFICER = UserRole.OFFICER
ADMIN = UserRole.ADMIN


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


@bp.get("/clusters")
@require_role(OFFICER, ADMIN)
@validate_query(ClusterListQuery)
def get_clusters(query: ClusterListQuery):
    """200 ClusterListResponse. Officers see their own zone; admins see all."""
    page = list_clusters(
        user=current_user(),
        zone_id=query.zoneId,
        page=query.page,
        page_size=query.pageSize,
        now=_utcnow(),
    )
    return jsonify(
        {
            "data": [serialize_cluster(cluster, page.ctx) for cluster in page.clusters],
            "pagination": page.pagination.to_dict(),
        }
    )


@bp.get("/clusters/<int:cluster_id>")
@require_role(OFFICER, ADMIN)
def get_cluster_by_id(cluster_id: int):
    """200 ClusterDetail — the cluster plus its current members."""
    now = _utcnow()
    cluster, ctx = load_cluster(user=current_user(), cluster_id=cluster_id, now=now)
    return jsonify(serialize_cluster_detail(cluster, ctx))


@bp.get("/zones/<int:zone_id>/summary")
@require_role(OFFICER, ADMIN)
def get_zone_summary(zone_id: int):
    """200 ZoneSummary. An officer may summarise only their own zone."""
    scoping.assert_can_view_zone(current_user(), zone_id)
    return jsonify(zone_summary(zone_id=zone_id))


@bp.get("/evidence/<int:evidence_id>/photo")
def get_evidence_photo(evidence_id: int):
    """200 image/jpeg|png. PUBLIC (`security: []`) — authorized by signature.

    This route is deliberately unusual, and the three rules are the whole design:

      1. It verifies the SIGNATURE AND NOTHING ELSE. No JWT, no session, no zone
         lookup — the check already happened when a serializer decided this
         caller could see the parent complaint and minted the link. A browser
         `<img>` tag cannot carry a bearer token; the signature carries that
         earlier verdict instead.
      2. It answers 403 for a bad signature AND for a missing evidence row
         ALIKE. A 404 would let anyone enumerate which evidence IDs exist.
      3. `Cache-Control: private, max-age=<remaining TTL>`, so the browser
         caches the image exactly as long as the link is valid and no shared
         proxy caches it at all.

    Served with `send_file` from UPLOAD_DIR, which sits outside the web root and
    is never registered as a static directory.
    """
    remaining_ttl = verify_photo_signature(
        evidence_id, request.args.get("exp"), request.args.get("sig")
    )

    path = photo_for_signed_request(
        evidence_id=evidence_id, upload_dir=current_app.config["UPLOAD_DIR"]
    )
    if path is None:
        # Same answer as a bad signature — see rule 2.
        raise ForbiddenError("This photo link is not valid.")

    response = send_file(path)
    response.headers["Cache-Control"] = f"private, max-age={remaining_ttl}"
    return response
