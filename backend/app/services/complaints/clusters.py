"""Cluster linking, recomputation, the resolution cascade, and the reward guard.

Reference implementation: `frontend/src/mocks/lib/cluster.ts`, and the rules in
`docs/backend/complaints/CLUSTERED_COMPLAINT_LIFECYCLE.MD`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import func, select, update

from app.domain.enums import PointsReason
from app.domain.severity import score
from app.extensions import db
from app.models import Complaint, ComplaintCluster, ComplaintUpvote, PointsLedger


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
    raise NotImplementedError


def recompute_cluster_aggregates(*, cluster_id: int, now: datetime) -> None:
    """Recompute centroid, report_count and unique_reporter_count from members.

    TODO(phase 5). `unique_reporter_count` is COUNT(DISTINCT citizen_id) — the
    anti-gaming measure. `report_count` is the raw row count.
    """
    raise NotImplementedError


def recompute_severity_for_cluster(*, cluster_id: int | None, complaint_id: int) -> None:
    """Refresh `complaints.severity_score` for a complaint or a whole cluster.

    TODO(phase 5). Per member: `domain.severity.score(cluster
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

    TODO(phase 6). Look for a points_ledger row with reason COMPLAINT_CLOSED or
    CLUSTER_MEMBER_CLOSED whose complaint belongs to this cluster and this
    citizen. Cluster rewards are paid at most once per citizen per cluster, so
    filing three complaints that get clustered together cannot farm rewards.
    """
    # Serialise reward decisions for members of this cluster, including when
    # reward_granted was already true before this transaction began.
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
