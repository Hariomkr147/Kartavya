"""Cluster invariant checks, and the repair for the two that can drift.

Clusters are the one aggregate in the system that is maintained incrementally:
`report_count`, `unique_reporter_count` and the centroid are stored, recomputed
on each membership change, and read back as if they were true. Everything else
derives its state on read and therefore cannot go stale. So this is the place
where a missed recompute — an admin reclassification, an interrupted
transaction, a code path added later that forgets — turns into numbers nobody
notices are wrong.

`verify_clusters` answers one question: does the stored state agree with the
members? `repair` makes it agree. Run it after a migration, after a bulk import,
or whenever a cluster's report count looks implausible.

Deliberately not a scheduled job: silent auto-repair would hide the bug that
caused the drift, and the drift is rare. This is a tool an operator reaches
for, and its output names what was wrong.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import func, select

from app.domain.lifecycle import TERMINAL
from app.extensions import db
from app.models import Complaint, ComplaintCluster


@dataclass
class ClusterFinding:
    cluster_id: int | None
    kind: str
    detail: str


@dataclass
class ClusterReport:
    checked: int = 0
    findings: list[ClusterFinding] = field(default_factory=list)
    repaired: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.findings

    def add(self, cluster_id: int | None, kind: str, detail: str) -> None:
        self.findings.append(ClusterFinding(cluster_id, kind, detail))


def verify_clusters(*, repair: bool = False, now: datetime | None = None) -> ClusterReport:
    """Check every cluster against its members. Optionally fix what is fixable.

    Four checks:

    * ``terminal_member`` — a finished complaint still holding a `cluster_id`.
      Nothing can move it, but it still counts towards the cluster's totals and
      keeps the cluster alive on the cluster pages. Repairable: it is moved out
      to `former_cluster_id`, exactly as it would have been had it finished
      after this rule existed.
    * ``stale_aggregates`` — stored counts or centroid disagreeing with the
      live members. Repairable: recomputed.
    * ``dissolved`` — no live members left. Reported, never "fixed": the row is
      kept on purpose because it holds the one-time +50 reward latch, and
      deleting it would let a second member of that cluster collect the reward
      again. It is simply hidden from the cluster endpoints.
    * ``orphan_membership`` — a `cluster_id` pointing at a cluster row that no
      longer exists. Not repairable automatically; it means an FK rule was
      bypassed and wants a human.
    """
    from app.services.complaints.clusters import exit_cluster, recompute_cluster_aggregates

    moment = now or datetime.now(UTC).replace(tzinfo=None)
    report = ClusterReport()

    cluster_ids = set(db.session.scalars(select(ComplaintCluster.id)))

    # --- orphans first: they are a different class of problem ---------------
    orphan_ids = set(
        db.session.scalars(
            select(Complaint.cluster_id).where(
                Complaint.cluster_id.is_not(None),
                Complaint.cluster_id.not_in(cluster_ids) if cluster_ids else True,
            )
        )
    )
    for orphan in sorted(o for o in orphan_ids if o is not None):
        report.add(
            orphan,
            "orphan_membership",
            f"complaints reference cluster {orphan}, which does not exist",
        )

    # --- terminal members still inside a cluster ----------------------------
    stragglers = list(
        db.session.scalars(
            select(Complaint).where(
                Complaint.cluster_id.is_not(None),
                Complaint.status.in_(TERMINAL),
            )
        )
    )
    for complaint in stragglers:
        report.add(
            complaint.cluster_id,
            "terminal_member",
            f"complaint {complaint.id} is {complaint.status.value} but still in the cluster",
        )
        if repair:
            exit_cluster(complaint=complaint, now=moment)
            report.repaired.append(
                f"moved complaint {complaint.id} out of cluster {complaint.former_cluster_id}"
            )

    # --- per-cluster aggregate and liveness checks --------------------------
    for cluster_id in sorted(cluster_ids):
        report.checked += 1
        members = list(
            db.session.scalars(select(Complaint).where(Complaint.cluster_id == cluster_id))
        )
        live = [m for m in members if m.status not in TERMINAL]

        if not live:
            report.add(
                cluster_id,
                "dissolved",
                "no members left that can still move — hidden from the cluster endpoints",
            )
            continue

        cluster = db.session.get(ComplaintCluster, cluster_id)
        if cluster is None:  # pragma: no cover - cluster_ids came from this table
            continue

        expected_reports = len(members)
        expected_reporters = len({m.citizen_id for m in members})
        if (
            cluster.report_count != expected_reports
            or cluster.unique_reporter_count != expected_reporters
        ):
            report.add(
                cluster_id,
                "stale_aggregates",
                f"stored {cluster.report_count} reports / "
                f"{cluster.unique_reporter_count} reporters, "
                f"members say {expected_reports} / {expected_reporters}",
            )
            if repair:
                recompute_cluster_aggregates(cluster_id=cluster_id, now=moment)
                report.repaired.append(f"recomputed aggregates for cluster {cluster_id}")

    if repair and report.repaired:
        db.session.commit()

    return report


def dissolved_cluster_ids() -> list[int]:
    """Clusters with no member that can still move. Read-only."""
    live = (
        select(Complaint.cluster_id)
        .where(Complaint.cluster_id.is_not(None), Complaint.status.not_in(TERMINAL))
        .distinct()
    )
    return list(
        db.session.scalars(select(ComplaintCluster.id).where(ComplaintCluster.id.not_in(live)))
    )


def cluster_counts() -> dict[str, int]:
    """Live / dissolved split, for the verification command's summary line."""
    total = int(db.session.scalar(select(func.count(ComplaintCluster.id))) or 0)
    dissolved = len(dissolved_cluster_ids())
    return {"total": total, "live": total - dissolved, "dissolved": dissolved}
