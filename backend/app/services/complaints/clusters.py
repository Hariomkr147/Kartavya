"""Cluster linking, recomputation, the resolution cascade, and the reward guard.

Reference implementation: `frontend/src/mocks/lib/cluster.ts`, and the rules in
`docs/backend/complaints/CLUSTERED_COMPLAINT_LIFECYCLE.MD`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import func, select, update

from app.domain.enums import ComplaintStatus
from app.domain.geo import haversine_meters
from app.domain.severity import score as severity_score
from app.extensions import db
from app.models import Complaint, ComplaintCluster, ComplaintUpvote


def detach_for_admin_reclassification(*, complaint: Complaint, now: datetime) -> None:
    """Remove a category/zone-edited complaint without leaving a corrupt cluster.

    Reclassification cannot preserve membership because clusters are strictly
    same-category and same-zone. Existing members are recomputed; a one-member
    remainder is dissolved because clusters represent duplicates.
    """
    old_cluster_id = complaint.cluster_id
    if old_cluster_id is None:
        return
    complaint.cluster_id = None
    remaining = list(
        db.session.scalars(
            select(Complaint).where(
                Complaint.cluster_id == old_cluster_id,
                Complaint.id != complaint.id,
            )
        )
    )
    if len(remaining) < 2:
        for member in remaining:
            member.cluster_id = None
        cluster = db.session.get(ComplaintCluster, old_cluster_id)
        if cluster is not None:
            db.session.delete(cluster)
            db.session.flush()
        affected = [complaint, *remaining]
        unique_reporters = 1
    else:
        cluster = db.session.get(ComplaintCluster, old_cluster_id)
        assert cluster is not None
        cluster.report_count = len(remaining)
        cluster.unique_reporter_count = len({row.citizen_id for row in remaining})
        cluster.centroid_lat = sum(row.latitude for row in remaining) / len(remaining)
        cluster.centroid_lng = sum(row.longitude for row in remaining) / len(remaining)
        cluster.updated_at = now
        affected = [complaint, *remaining]
        unique_reporters = cluster.unique_reporter_count
    counts = {
        complaint_id: int(count)
        for complaint_id, count in db.session.execute(
            select(ComplaintUpvote.complaint_id, func.count(ComplaintUpvote.id))
            .where(ComplaintUpvote.complaint_id.in_([row.id for row in affected]))
            .group_by(ComplaintUpvote.complaint_id)
        )
    }
    for member in affected:
        reporters = unique_reporters if member.cluster_id is not None else 1
        member.severity_score = severity_score(reporters, counts.get(member.id, 0))


def link_new_complaint(*, complaint: Complaint, radius_meters: float, now: datetime) -> None:
    """Attach a freshly created complaint to a cluster, if there is one.

    TODO(phase 5). Three-step search, all within `radius_meters` and requiring
    the SAME category and SAME zone:
      1. An existing cluster whose centroid is nearest -> join it.
      2. Else the nearest matching STANDALONE complaint -> form a new cluster
         from the two. A REJECTED complaint is excluded as a seed: a debunked
         fake report must not anchor a new cluster.
      3. Else stay standalone.

    Then recompute the centroid, report_count and unique_reporter_count, and
    call `recompute_severity_for_cluster` for EVERY member — not just the new
    one. A membership change moves everyone's score.
    """
    clusters = list(
        db.session.scalars(
            select(ComplaintCluster).where(
                ComplaintCluster.category_id == complaint.category_id,
                ComplaintCluster.zone_id == complaint.zone_id,
            )
        )
    )
    nearby_clusters = [
        (
            haversine_meters(
                complaint.latitude,
                complaint.longitude,
                cluster.centroid_lat,
                cluster.centroid_lng,
            ),
            cluster,
        )
        for cluster in clusters
    ]
    nearby_clusters = [item for item in nearby_clusters if item[0] <= radius_meters]
    if nearby_clusters:
        _, cluster = min(nearby_clusters, key=lambda item: (item[0], item[1].id))
        complaint.cluster_id = cluster.id
        db.session.flush()
        recompute_cluster_aggregates(cluster_id=cluster.id, now=now)
        recompute_severity_for_cluster(cluster_id=cluster.id, complaint_id=complaint.id)
        return

    standalone = list(
        db.session.scalars(
            select(Complaint).where(
                Complaint.id != complaint.id,
                Complaint.cluster_id.is_(None),
                Complaint.category_id == complaint.category_id,
                Complaint.zone_id == complaint.zone_id,
                Complaint.status != ComplaintStatus.REJECTED,
            )
        )
    )
    nearby_standalone = [
        (
            haversine_meters(
                complaint.latitude,
                complaint.longitude,
                candidate.latitude,
                candidate.longitude,
            ),
            candidate,
        )
        for candidate in standalone
    ]
    nearby_standalone = [item for item in nearby_standalone if item[0] <= radius_meters]
    if nearby_standalone:
        _, candidate = min(nearby_standalone, key=lambda item: (item[0], item[1].id))
        cluster = ComplaintCluster(
            category_id=complaint.category_id,
            zone_id=complaint.zone_id,
            centroid_lat=(complaint.latitude + candidate.latitude) / 2,
            centroid_lng=(complaint.longitude + candidate.longitude) / 2,
            report_count=2,
            unique_reporter_count=len({complaint.citizen_id, candidate.citizen_id}),
            reward_granted=False,
            created_at=now,
            updated_at=now,
        )
        db.session.add(cluster)
        db.session.flush()
        complaint.cluster_id = cluster.id
        candidate.cluster_id = cluster.id
        db.session.flush()
        recompute_cluster_aggregates(cluster_id=cluster.id, now=now)
        recompute_severity_for_cluster(cluster_id=cluster.id, complaint_id=complaint.id)
        return

    recompute_severity_for_cluster(cluster_id=None, complaint_id=complaint.id)


def recompute_cluster_aggregates(*, cluster_id: int, now: datetime) -> None:
    """Recompute centroid, report_count and unique_reporter_count from members.

    TODO(phase 5). `unique_reporter_count` is COUNT(DISTINCT citizen_id) — the
    anti-gaming measure. `report_count` is the raw row count.
    """
    cluster = db.session.get(ComplaintCluster, cluster_id)
    if cluster is None:
        return
    members = list(
        db.session.scalars(select(Complaint).where(Complaint.cluster_id == cluster_id))
    )
    if not members:
        db.session.delete(cluster)
        return
    cluster.report_count = len(members)
    cluster.unique_reporter_count = len({row.citizen_id for row in members})
    cluster.centroid_lat = sum(row.latitude for row in members) / len(members)
    cluster.centroid_lng = sum(row.longitude for row in members) / len(members)
    cluster.updated_at = now


def recompute_severity_for_cluster(*, cluster_id: int | None, complaint_id: int) -> None:
    """Refresh `complaints.severity_score` for a complaint or a whole cluster.

    TODO(phase 5). Per member: `domain.severity.score(cluster
    unique_reporter_count or 1, that member's OWN upvote count)`.

    Careful: a complaint's score uses only its own upvotes, while the API's
    Cluster.severityScore uses the total across all members. Same function,
    different arguments — passing the wrong upvote total is invisible.

    Call this on: complaint creation, cluster join, and every upvote.
    """
    if cluster_id is None:
        complaint = db.session.get(Complaint, complaint_id)
        rows = [complaint] if complaint is not None else []
        unique_reporters = 1
    else:
        cluster = db.session.get(ComplaintCluster, cluster_id)
        if cluster is None:
            return
        rows = list(
            db.session.scalars(select(Complaint).where(Complaint.cluster_id == cluster_id))
        )
        unique_reporters = cluster.unique_reporter_count

    if not rows:
        return
    ids = [row.id for row in rows]
    counts = {
        row_id: int(count)
        for row_id, count in db.session.execute(
            select(ComplaintUpvote.complaint_id, func.count(ComplaintUpvote.id))
            .where(ComplaintUpvote.complaint_id.in_(ids))
            .group_by(ComplaintUpvote.complaint_id)
        )
    }
    for row in rows:
        row.severity_score = severity_score(unique_reporters, counts.get(row.id, 0))


def claim_cluster_reward(*, cluster_id: int) -> bool:
    """Atomic test-and-set: did THIS confirm win the one-time +50?

    The highest-stakes race in the system — getting it wrong pays +50 twice.
    The test-and-set IS the decision, and it must happen in the same transaction
    as the CLOSED write.
    """
    return (
        db.session.execute(
            update(ComplaintCluster)
            .where(
                ComplaintCluster.id == cluster_id,
                ComplaintCluster.reward_granted.is_(False),
            )
            .values(reward_granted=True)
            .execution_options(synchronize_session="fetch")
        ).rowcount
        == 1
    )


def citizen_already_rewarded_in_cluster(*, cluster_id: int, citizen_id: int) -> bool:
    """Has this citizen already been paid a cluster reward here?

    TODO(phase 6). Look for a points_ledger row with reason COMPLAINT_CLOSED or
    CLUSTER_MEMBER_CLOSED whose complaint belongs to this cluster and this
    citizen. Cluster rewards are paid at most once per citizen per cluster, so
    filing three complaints that get clustered together cannot farm rewards.
    """
    raise NotImplementedError


def cascade_resolution(*, resolved: Complaint, now: datetime) -> list[dict[str, Any]]:
    """Sweep the rest of the cluster to RESOLVED when the shared issue is fixed.

    TODO(phase 5). For every OTHER member:
      * UNDER_REVIEW / IN_PROGRESS / UNDER_RESOLUTION -> RESOLVED, with its own
        `status_history` row at actor_role=SYSTEM  -> "CASCADED"
      * anything else -> untouched -> "SKIPPED"

    What must be SKIPPED, and why:
      * terminal and already-RESOLVED members — nothing to do;
      * evidence-phase members (SUBMITTED / EVIDENCE_UNDER_REVIEW /
        NEEDS_MORE_EVIDENCE) — the evidence gate is never bypassed by riding a
        cluster resolution;
      * REOPENED members — a pending dispute always waits for its admin verdict.
        A sibling's fix must never sweep it aside first.

    Every move still goes through `lifecycle.apply_transition`, so the SYSTEM
    transitions get proper history rows like everything else. Returns the
    per-member outcome list the contract puts in `StatusUpdateResult.cascade`.
    """
    raise NotImplementedError
