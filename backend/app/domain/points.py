"""What each point event is worth, and which one a given close earns.

Amounts are fixed by the contract. The ledger is append-only and there is no
stored total anywhere: lifetime CSP is `SUM(points_ledger.points_change)`.

Ported from `frontend/src/mocks/lib/points.ts`.
"""

from __future__ import annotations

from app.domain.enums import PointsReason

POINTS_AMOUNTS: dict[PointsReason, int] = {
    PointsReason.COMPLAINT_CLOSED: 50,
    PointsReason.CLUSTER_MEMBER_CLOSED: 10,
    PointsReason.FIRST_COMPLAINT: 10,
    PointsReason.ON_TIME_BONUS: 15,
    PointsReason.UPVOTE_RECEIVED: 5,
    PointsReason.REJECTED_PENALTY: -20,
}


def amount(reason: PointsReason) -> int:
    return POINTS_AMOUNTS[reason]


def close_reward(
    *,
    is_clustered: bool,
    cluster_reward_already_granted: bool,
    citizen_already_rewarded_in_cluster: bool,
) -> PointsReason | None:
    """Which reward an explicit citizen confirm earns — or None.

    The three rules this encodes, all from the contract:

    * The +50 is paid once per cluster, to whoever *confirms* first — not
      whoever reported first. `cluster_reward_already_granted` must come from an
      atomic test-and-set on `complaint_clusters.reward_granted` in the same
      transaction as the CLOSED write, never from a plain read.
    * It is paid at most once per citizen per cluster. If you filed three
      complaints that got clustered together, only your first confirm pays;
      confirming the others closes them and credits nothing. Otherwise duplicate
      filing farms rewards.
    * A standalone complaint always pays the full +50.

    Callers must NOT use this for auto-close or for an admin-rejected dispute —
    both credit zero. Rewards flow only through an explicit citizen confirm.
    """
    if not is_clustered:
        return PointsReason.COMPLAINT_CLOSED
    if citizen_already_rewarded_in_cluster:
        return None
    if cluster_reward_already_granted:
        return PointsReason.CLUSTER_MEMBER_CLOSED
    return PointsReason.COMPLAINT_CLOSED


def earns_on_time_bonus(sla_label_at_close: str | None) -> bool:
    """ON_TIME_BONUS is evaluated per complaint against its own SLA snapshot.

    Completely independent of the cluster reward: a member who only got the +10
    can still separately earn +15.
    """
    return sla_label_at_close == "ON_TIME"
