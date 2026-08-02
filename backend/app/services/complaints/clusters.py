"""Cluster linking, recomputation, the resolution cascade, and the reward guard.

Reference implementation: `frontend/src/mocks/lib/cluster.ts`, and the rules in
`docs/backend/complaints/CLUSTERED_COMPLAINT_LIFECYCLE.MD`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import func, select, update

from app.domain import geo, severity
from app.domain.enums import ComplaintStatus, PointsReason, StatusActor
from app.domain.errors import ConflictError
from app.domain.lifecycle import CASCADE_ELIGIBLE
from app.domain.severity import score
from app.extensions import db
from app.models import Complaint, ComplaintCluster, ComplaintUpvote, PointsLedger


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
        member.severity_score = severity.score(reporters, counts.get(member.id, 0))


def link_new_complaint(*, complaint: Complaint, radius_meters: float, now: datetime) -> None:
    """Attach a freshly created complaint to a cluster, if there is one within radius."""
    # Find same-category, same-zone, non-rejected complaints within radius
    candidates = (
        db.session.execute(
            select(Complaint).where(
                Complaint.category_id == complaint.category_id,
                Complaint.zone_id == complaint.zone_id,
                Complaint.id != complaint.id,
                Complaint.status != ComplaintStatus.REJECTED,
            )
        )
        .scalars()
        .all()
    )

    # Filter by radius
    nearby = [
        c
        for c in candidates
        if geo.within_radius(
            float(complaint.latitude),
            float(complaint.longitude),
            float(c.latitude),
            float(c.longitude),
            radius_meters,
        )
    ]
    if not nearby:
        return

    # Separate into cluster members and standalone complaints
    cluster_ids = {c.cluster_id for c in nearby if c.cluster_id is not None}
    standalone = [c for c in nearby if c.cluster_id is None]

    chosen_cluster_id = None

    # Prefer existing clusters
    if cluster_ids:
        # Find the cluster whose centroid is nearest AND within radius
        clusters = (
            db.session.execute(select(ComplaintCluster).where(ComplaintCluster.id.in_(cluster_ids)))
            .scalars()
            .all()
        )

        nearest = None
        nearest_dist = float("inf")
        for cl in clusters:
            dist = geo.haversine_meters(
                float(complaint.latitude),
                float(complaint.longitude),
                float(cl.centroid_lat),
                float(cl.centroid_lng),
            )
            if dist < nearest_dist and dist <= radius_meters:
                nearest_dist = dist
                nearest = cl

        if nearest is not None:
            chosen_cluster_id = nearest.id
            complaint.cluster_id = chosen_cluster_id

    # No nearby cluster found — try to form a new one with a standalone
    if chosen_cluster_id is None and standalone:
        nearest = min(
            standalone,
            key=lambda c: geo.haversine_meters(
                float(complaint.latitude),
                float(complaint.longitude),
                float(c.latitude),
                float(c.longitude),
            ),
        )
        # Create new cluster
        new_cluster = ComplaintCluster(
            category_id=complaint.category_id,
            zone_id=complaint.zone_id,
            centroid_lat=float(complaint.latitude),
            centroid_lng=float(complaint.longitude),
            report_count=2,
            unique_reporter_count=2,
            reward_granted=False,
            created_at=now,
            updated_at=now,
        )
        db.session.add(new_cluster)
        db.session.flush()

        complaint.cluster_id = new_cluster.id
        nearest.cluster_id = new_cluster.id
        chosen_cluster_id = new_cluster.id

    if chosen_cluster_id:
        recompute_cluster_aggregates(cluster_id=chosen_cluster_id, now=now)
        # recompute_severity_for_cluster is called by recompute_cluster_aggregates for all members


def recompute_cluster_aggregates(*, cluster_id: int, now: datetime) -> None:
    """Recompute centroid, report_count and unique_reporter_count from members."""
    cluster = db.session.get(ComplaintCluster, cluster_id)
    if not cluster:
        return

    members = (
        db.session.execute(select(Complaint).where(Complaint.cluster_id == cluster_id))
        .scalars()
        .all()
    )

    if not members:
        return

    cluster.report_count = len(members)
    unique_citizens = {m.citizen_id for m in members}
    cluster.unique_reporter_count = len(unique_citizens)

    c_lat, c_lng = geo.centroid([(float(m.latitude), float(m.longitude)) for m in members])
    cluster.centroid_lat = c_lat
    cluster.centroid_lng = c_lng
    cluster.updated_at = now

    # Batch recompute severity for all members
    unique_count = cluster.unique_reporter_count
    for member in members:
        upvotes = (
            db.session.execute(
                select(func.count(ComplaintUpvote.id)).where(
                    ComplaintUpvote.complaint_id == member.id
                )
            ).scalar()
            or 0
        )
        member.severity_score = severity.score(unique_count, upvotes)


def recompute_severity_for_cluster(*, cluster_id: int | None, complaint_id: int) -> None:
    """Refresh `complaints.severity_score` for a complaint or a whole cluster.

    Per member: `domain.severity.score(cluster
    unique_reporter_count or 1, that member's OWN upvote count)`.

    Careful: a complaint's score uses only its own upvotes, while the API's
    Cluster.severityScore uses the total across all members. Same function,
    different arguments — passing the wrong upvote total is invisible.

    Call this on: complaint creation, cluster join, and every upvote.
    """
    complaint_ids = [complaint_id]
    reporter_count = 1
    if cluster_id is not None:
        cluster = db.session.get(ComplaintCluster, cluster_id)
        if cluster is not None:
            reporter_count = cluster.unique_reporter_count
            complaint_ids = list(
                db.session.execute(
                    select(Complaint.id).where(Complaint.cluster_id == cluster_id)
                ).scalars()
            )

    counts = dict(
        db.session.execute(
            select(ComplaintUpvote.complaint_id, func.count(ComplaintUpvote.id))
            .where(ComplaintUpvote.complaint_id.in_(complaint_ids))
            .group_by(ComplaintUpvote.complaint_id)
        ).all()
    )
    for member in db.session.execute(
        select(Complaint).where(Complaint.id.in_(complaint_ids))
    ).scalars():
        member.severity_score = score(reporter_count, int(counts.get(member.id, 0)))


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

    A points_ledger row with reason COMPLAINT_CLOSED or CLUSTER_MEMBER_CLOSED
    whose complaint belongs to this cluster and this citizen. Cluster rewards are
    paid at most once per citizen per cluster, so filing three complaints that
    get clustered together cannot farm rewards.

    Call this BEFORE `claim_cluster_reward` — see `lifecycle.confirm_resolution`.
    """
    # Take the cluster row first, so this read and the claim that follows it are
    # one decision rather than two.
    #
    # ⚠ On SQLite this renders nothing at all — the dialect drops FOR UPDATE
    # silently. What actually serialises concurrent confirms there is SQLite's
    # single-writer lock, which the claim's UPDATE takes. This line is the
    # equivalent guarantee for Postgres; it is not what is protecting us today.
    db.session.execute(
        select(ComplaintCluster.id).where(ComplaintCluster.id == cluster_id).with_for_update()
    ).scalar_one_or_none()
    return (
        db.session.execute(
            select(func.count(PointsLedger.id))
            .join(Complaint, Complaint.id == PointsLedger.complaint_id)
            .where(
                PointsLedger.citizen_id == citizen_id,
                Complaint.cluster_id == cluster_id,
                PointsLedger.reason.in_(
                    [
                        PointsReason.COMPLAINT_CLOSED,
                        PointsReason.CLUSTER_MEMBER_CLOSED,
                    ]
                ),
            )
        ).scalar_one()
        > 0
    )


def cascade_resolution(*, resolved: Complaint, now: datetime) -> list[dict[str, Any]]:
    """Sweep the rest of the cluster to RESOLVED when the shared issue is fixed."""
    # Local import avoids a cycle: lifecycle imports the cluster reward helpers.
    from app.services.complaints import lifecycle

    if not resolved.cluster_id:
        return []

    cluster_members = (
        db.session.execute(
            select(Complaint).where(
                Complaint.cluster_id == resolved.cluster_id,
                Complaint.id != resolved.id,
            )
        )
        .scalars()
        .all()
    )

    results = []
    for member in cluster_members:
        # Snapshot the status BEFORE the transition. `apply_transition` runs its
        # UPDATE with synchronize_session="fetch", which refreshes this very
        # instance — read `member.status` afterwards and every CASCADED entry
        # reports the new status as its `previousStatus`.
        previous_status = member.status

        if previous_status not in CASCADE_ELIGIBLE:
            results.append(
                {
                    "complaintId": str(member.id),
                    "outcome": "SKIPPED",
                    "previousStatus": previous_status.value,
                }
            )
            continue

        try:
            lifecycle.apply_transition(
                complaint_id=member.id,
                expected_status=previous_status,
                new_status=ComplaintStatus.RESOLVED,
                actor_role=StatusActor.SYSTEM,
                changed_by_user_id=None,
                now=now,
                extra_values={"resolved_at": now},
            )
            outcome = "CASCADED"
        except ConflictError:
            # Race: another thread moved it between the SELECT and the UPDATE.
            outcome = "SKIPPED"

        results.append(
            {
                "complaintId": str(member.id),
                "outcome": outcome,
                "previousStatus": previous_status.value,
            }
        )

    return results
