"""Read-side cluster queries, with their serialization context preloaded.

Split from `clusters.py` (the write side: linking, cascade, the reward guard)
for the same reason `reads.py` is split from `submission.py` — and so the
`/clusters*` routes can stay free of `db.session`, per architecture §3.3.

A cluster's severity and `statusSummary` are derived from its members on read,
never stored, so every one of these loaders returns the members alongside the
cluster row: a serializer is not allowed to fetch them itself.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select

from app.core.context import SerializationContext
from app.core.scoping import assert_can_view_zone, visible_clusters, visible_complaints
from app.domain.errors import NotFoundError
from app.extensions import db
from app.models import (
    Complaint,
    ComplaintCategory,
    ComplaintCluster,
    ComplaintEvidence,
    ComplaintUpvote,
    User,
    Zone,
)
from app.services.queries import Pagination, apply_pagination, clamp_page_args


@dataclass(frozen=True)
class ClusterPage:
    clusters: list[ComplaintCluster]
    ctx: SerializationContext
    pagination: Pagination


def _member_context(
    clusters: list[ComplaintCluster], members: list[Complaint], now: datetime
) -> SerializationContext:
    """One context covering every member of every cluster on this page."""
    ctx = SerializationContext(now=now)
    if not clusters:
        return ctx

    for member in members:
        ctx.cluster_members.setdefault(member.cluster_id, []).append(member)

    category_ids = {member.category_id for member in members} | {
        cluster.category_id for cluster in clusters
    }
    zone_ids = {member.zone_id for member in members} | {cluster.zone_id for cluster in clusters}
    ctx.categories = {
        row.id: row
        for row in db.session.scalars(
            select(ComplaintCategory).where(ComplaintCategory.id.in_(category_ids))
        )
    }
    ctx.zones = {
        row.id: row for row in db.session.scalars(select(Zone).where(Zone.id.in_(zone_ids)))
    }

    member_ids = [member.id for member in members]
    if member_ids:
        ctx.upvote_counts = {
            complaint_id: int(count)
            for complaint_id, count in db.session.execute(
                select(ComplaintUpvote.complaint_id, func.count(ComplaintUpvote.id))
                .where(ComplaintUpvote.complaint_id.in_(member_ids))
                .group_by(ComplaintUpvote.complaint_id)
            )
        }
        for row in db.session.scalars(
            select(ComplaintEvidence)
            .where(ComplaintEvidence.complaint_id.in_(member_ids))
            .order_by(ComplaintEvidence.complaint_id, ComplaintEvidence.sequence)
        ):
            ctx.first_evidence.setdefault(row.complaint_id, row)
    return ctx


def list_clusters(
    *, user: User, zone_id: int | None, page: int | None, page_size: int | None, now: datetime
) -> ClusterPage:
    """GET /clusters — admins see every zone, officers only their own."""
    resolved_page, resolved_size = clamp_page_args(page, page_size, max_page_size=100)

    query = visible_clusters(user)
    if zone_id is not None:
        # `zoneId` is admin-only in the contract. Refuse an officer naming
        # someone else's zone outright rather than silently handing back an
        # empty page, which reads as "that zone has no clusters".
        assert_can_view_zone(user, zone_id)
        query = query.where(ComplaintCluster.zone_id == zone_id)

    total = db.session.scalar(select(func.count()).select_from(query.subquery())) or 0
    clusters = list(
        db.session.scalars(
            apply_pagination(
                query.order_by(ComplaintCluster.created_at.desc(), ComplaintCluster.id.desc()),
                resolved_page,
                resolved_size,
            )
        )
    )

    members: list[Complaint] = []
    if clusters:
        members = list(
            db.session.scalars(
                select(Complaint)
                .where(Complaint.cluster_id.in_([cluster.id for cluster in clusters]))
                .order_by(Complaint.id)
            )
        )

    return ClusterPage(
        clusters=clusters,
        ctx=_member_context(clusters, members, now),
        pagination=Pagination(resolved_page, resolved_size, int(total)),
    )


def load_cluster(
    *, user: User, cluster_id: int, now: datetime
) -> tuple[ComplaintCluster, SerializationContext]:
    """GET /clusters/{id}. Scoped through `visible_clusters`, like the list."""
    cluster = db.session.scalar(
        visible_clusters(user).where(ComplaintCluster.id == cluster_id)
    )
    if cluster is None:
        raise NotFoundError("No such cluster.")

    # Members are re-scoped individually: an admin override can move a single
    # complaint to another zone without moving its cluster, and an officer must
    # not see that member through the cluster's back door.
    members = list(
        db.session.scalars(
            visible_complaints(user)
            .where(Complaint.cluster_id == cluster_id)
            .order_by(Complaint.id)
        )
    )
    return cluster, _member_context([cluster], members, now)
