"""THE single choke point for every status write in the system.

    No other module may assign to `complaint.status`. Not the officer routes,
    not the admin routes, not the cascade, not the sweeper. All of them call
    into here.

Because the `status_history` row is written inside `apply_transition()`, a
status change without a matching audit entry is structurally impossible. If you
find yourself typing `complaint.status = ...` anywhere else in this codebase,
stop — that is precisely the bug this design exists to prevent.

The pure rules ("is this legal?") live in `app/domain/lifecycle.py`. This module
owns the *side effects*: the guarded UPDATE, the history row, the SLA columns,
the cascade, and the points.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from flask import current_app
from sqlalchemy import select, update

from app.core.session import transaction
from app.domain.enums import (
    ComplaintStatus,
    DisputeVerdict,
    EvidenceVerdict,
    OfficerTargetStatus,
    PointsReason,
    StatusActor,
)
from app.domain.errors import ConflictError, ForbiddenError, NotFoundError, raise_for
from app.domain.lifecycle import validate_confirm, validate_dispute
from app.domain.points import close_reward, earns_on_time_bonus
from app.domain.sla import label as sla_label
from app.extensions import db
from app.infra.storage import remove_photo
from app.models import Complaint, StatusHistory, User
from app.services.complaints.clusters import (
    citizen_already_rewarded_in_cluster,
    claim_cluster_reward,
)
from app.services.complaints.evidence import attach_photos
from app.services.complaints.views import ComplaintDetailData, load_complaint_detail
from app.services.gamification.badges import evaluate_and_award
from app.services.gamification.ledger import award


@dataclass
class TransitionResult:
    """What a door returns to its route. `cascade` is empty unless a cluster moved."""

    complaint: Complaint
    cascade: list[dict[str, Any]]


# --- The primitive every door goes through -----------------------------------


def apply_transition(
    *,
    complaint_id: int,
    expected_status: ComplaintStatus | set[ComplaintStatus],
    new_status: ComplaintStatus,
    actor_role: StatusActor,
    changed_by_user_id: int | None,
    now: datetime,
    reason: str | None = None,
    remark: str | None = None,
    extra_values: dict[str, Any] | None = None,
) -> Complaint:
    """Move a complaint, guarded by its expected current status.

    The guard is the whole point. The naive read-decide-write is broken:

        complaint = session.get(Complaint, cid)
        if complaint.status != "SUBMITTED":   # both threads can be here at once
            raise ConflictError(...)
        complaint.status = "EVIDENCE_UNDER_REVIEW"   # both write; last wins

    Putting the expected state in the WHERE clause lets `rowcount` make the
    decision instead: exactly one of two concurrent callers gets 1, the other
    gets 0 and a clean 409 — which is what the contract specifies for a
    contested claim.

    Args:
        expected_status: the status(es) this move is legal from. Becomes the
            guard. Pass a set for doors with several legal sources (e.g.
            UNRESOLVABLE).
        extra_values: additional columns to set in the SAME statement — e.g.
            `assigned_officer_id` on claim, `resolved_at` on resolve, the SLA
            columns on accept. Setting them separately would open the very race
            this guard closes.

    Raises:
        ConflictError: INVALID_TRANSITION, when nothing matched the guard.
    """
    expected = (
        {expected_status} if isinstance(expected_status, ComplaintStatus) else expected_status
    )

    # Read the outgoing status first, so the history row can name it. The guard
    # below is what makes this safe to rely on: if the row moved between this
    # SELECT and the UPDATE, the UPDATE matches nothing and we raise instead of
    # writing a history entry with a `from_status` that never happened.
    previous_status = db.session.execute(
        select(Complaint.status).where(Complaint.id == complaint_id)
    ).scalar_one_or_none()
    if previous_status is None:
        raise NotFoundError("No such complaint.")

    values: dict[str, Any] = {"status": new_status, "updated_at": now, **(extra_values or {})}

    rowcount = db.session.execute(
        update(Complaint)
        .where(Complaint.id == complaint_id, Complaint.status.in_(expected))
        .values(**values)
        # Keep any already-loaded Complaint in this session in step with the
        # UPDATE, so the serializer downstream does not read a stale status.
        .execution_options(synchronize_session="fetch")
    ).rowcount

    if rowcount == 0:
        raise ConflictError(
            "INVALID_TRANSITION",
            "This complaint has already moved on — reload it and try again.",
        )

    complaint = db.session.get(Complaint, complaint_id)
    assert complaint is not None  # the UPDATE just matched it

    record_history(
        complaint_id=complaint_id,
        from_status=previous_status,
        to_status=new_status,
        actor_role=actor_role,
        changed_by_user_id=changed_by_user_id,
        reason=reason,
        remark=remark,
        now=now,
    )
    return complaint


def record_history(
    *,
    complaint_id: int,
    from_status: ComplaintStatus | None,
    to_status: ComplaintStatus,
    actor_role: StatusActor,
    changed_by_user_id: int | None,
    now: datetime,
    reason: str | None = None,
    remark: str | None = None,
) -> StatusHistory:
    """Append one audit row. INSERT only — there is no update path, ever.

    `changed_by_user_id` must be None exactly when `actor_role` is SYSTEM.
    """
    entry = StatusHistory(
        complaint_id=complaint_id,
        from_status=from_status,
        to_status=to_status,
        actor_role=actor_role,
        changed_by_user_id=changed_by_user_id,
        reason=reason,
        remark=remark,
        created_at=now,
    )
    db.session.add(entry)
    return entry


# --- Door 1: POST /officer/complaints/{id}/claim ------------------------------


def claim(*, complaint_id: int, officer: User, now: datetime) -> Complaint:
    """SUBMITTED -> EVIDENCE_UNDER_REVIEW, setting assigned_officer_id.

    TODO(phase 4). Steps:
      1. Load through `scoping.visible_complaints(officer)` — 404 if not in zone.
      2. `domain.lifecycle.validate_claim(current)`.
      3. `apply_transition(expected_status=SUBMITTED, ...,
         extra_values={"assigned_officer_id": officer.id})`.
      4. Commit once, in the caller's `transaction()`.
    """
    raise NotImplementedError


# --- Door 2: POST /officer/complaints/{id}/evidence-review --------------------


def review_evidence(
    *,
    complaint_id: int,
    officer: User,
    verdict: EvidenceVerdict,
    reason: str | None,
    now: datetime,
) -> Complaint:
    """The photo verdict. Three outcomes, three different side effects.

    TODO(phase 4). Steps:
      1. Load zone-scoped; `domain.lifecycle.validate_evidence_review(
         current, complaint.sla_started_at, verdict, reason)` — this is where
         REJECTED-on-a-second-round becomes a 409.
      2. Stamp the latest evidence row: verdict, verdict_reason, reviewed_by,
         reviewed_at. (Append-only table, but these verdict columns are the one
         documented write — they are null until reviewed.)
      3. VALID -> UNDER_REVIEW, and START the SLA clock:
         `domain.sla.start(now, category.sla_hours)` — snapshot the category's
         CURRENT sla_hours onto the complaint.
         NEEDS_MORE_EVIDENCE -> pause via `domain.sla.pause(...)` (a no-op
         pre-acceptance, since the clock has not started).
         REJECTED -> terminal, and award REJECTED_PENALTY (-20) to the reporter.
      4. One `apply_transition` call with the SLA columns in `extra_values`.
    """
    raise NotImplementedError


# --- Doors 3 & 4: PATCH .../status and POST .../batch-status ------------------


def transition_by_officer(
    *,
    complaint_id: int,
    officer: User,
    target: OfficerTargetStatus,
    reason: str | None,
    note: str | None,
    now: datetime,
) -> TransitionResult:
    """The ordinary officer status move — the most involved request in the system.

    TODO(phase 4). Steps:
      1. Load zone-scoped -> 404 / 403.
      2. `domain.lifecycle.validate_officer_transition(current, target, reason)`.
      3. `apply_transition`, with `extra_values`:
         - RESOLVED  -> {"resolved_at": now}
         - NEEDS_MORE_EVIDENCE -> {"sla_paused_at": domain.sla.pause(
              complaint.sla_started_at, now)}  # pauses a RUNNING clock only
      4. If target is RESOLVED and the complaint is clustered, call
         `clusters.cascade_resolution(...)` and return its per-member outcomes
         as `TransitionResult.cascade`.
      5. The caller commits once.
    """
    raise NotImplementedError


def transition_batch(
    *,
    officer: User,
    complaint_ids: list[int] | None,
    cluster_id: int | None,
    target: OfficerTargetStatus,
    reason: str | None,
    note: str | None,
    now: datetime,
) -> dict[str, Any]:
    """The one endpoint where partial failure is a SUCCESS response.

    TODO(phase 5). Semantics that differ from every other door:
      * Validate all -> apply the valid ones -> ONE commit.
      * Per-item failures are `TransitionFailureCode` values inside the 200
        body, not rollbacks and not 4xx.
      * An unknown complaint ID is a per-item UNKNOWN_COMPLAINT. An unknown
        `clusterId` IS a 404. That difference is deliberate.
      * Exactly one of `complaint_ids` / `cluster_id` — the schema's `oneOf`
        makes both-or-neither a 400 before it reaches here.
      * Wrap each item in `core.session.savepoint()` so one item's database
        error cannot poison the batch.
    """
    raise NotImplementedError


# --- Door 5: POST /complaints/{id}/confirm ------------------------------------


def confirm_resolution(*, complaint_id: int, citizen: User, now: datetime) -> ComplaintDetailData:
    """RESOLVED -> CLOSED, and the ONLY path that credits confirm rewards.

    Steps, all in one transaction:
      1. Ownership check (a citizen confirms their own complaint only).
      2. `domain.lifecycle.validate_confirm(current)`.
      3. `apply_transition(expected_status=RESOLVED, new_status=CLOSED,
         extra_values={"closed_at": now})` — the guard is what makes a
         double-clicked confirm idempotent instead of double-paying.
      4. Cluster reward: atomic test-and-set on `reward_granted`
         (see clusters.claim_cluster_reward), then
         `domain.points.close_reward(...)` decides +50 / +10 / nothing.
      5. ON_TIME_BONUS independently, per this complaint's own SLA snapshot.
      6. Re-evaluate badges.
    """
    with transaction():
        complaint = db.session.get(Complaint, complaint_id)
        if complaint is None:
            raise NotFoundError("No such complaint.")
        if complaint.citizen_id != citizen.id:
            raise ForbiddenError("You do not have access to this complaint.")
        raise_for(validate_confirm(complaint.status))

        complaint = apply_transition(
            complaint_id=complaint.id,
            expected_status=ComplaintStatus.RESOLVED,
            new_status=ComplaintStatus.CLOSED,
            actor_role=StatusActor.CITIZEN,
            changed_by_user_id=citizen.id,
            now=now,
            extra_values={"closed_at": now},
        )

        reward_reason: PointsReason | None
        if complaint.cluster_id is None:
            reward_reason = close_reward(
                is_clustered=False,
                cluster_reward_already_granted=False,
                citizen_already_rewarded_in_cluster=False,
            )
        else:
            # Order matters. The per-citizen check runs FIRST so that a citizen
            # who has already been paid in this cluster cannot consume the
            # one-time +50 on their way to earning nothing — which would silently
            # demote the next member's confirm from +50 to +10. Do not lean on
            # "already paid implies reward_granted": once cluster linking lands,
            # an already-rewarded CLOSED complaint can join a fresh cluster whose
            # flag is still false. `frontend/src/mocks/handlers/complaints.ts`
            # orders it the same way.
            already_rewarded = citizen_already_rewarded_in_cluster(
                cluster_id=complaint.cluster_id,
                citizen_id=citizen.id,
            )
            won_cluster_reward = not already_rewarded and claim_cluster_reward(
                cluster_id=complaint.cluster_id
            )
            reward_reason = close_reward(
                is_clustered=True,
                cluster_reward_already_granted=not won_cluster_reward,
                citizen_already_rewarded_in_cluster=already_rewarded,
            )
        if reward_reason is not None:
            award(
                citizen_id=citizen.id,
                complaint_id=complaint.id,
                reason=reward_reason,
                now=now,
            )

        current_sla = sla_label(
            complaint.sla_target_hours,
            complaint.sla_started_at,
            complaint.sla_paused_seconds,
            complaint.sla_paused_at,
            now,
        )
        if earns_on_time_bonus(current_sla.value if current_sla else None):
            award(
                citizen_id=citizen.id,
                complaint_id=complaint.id,
                reason=PointsReason.ON_TIME_BONUS,
                now=now,
            )
        # Not redundant with the evaluation `award()` already does: a duplicate
        # confirm inside one cluster credits ZERO points, so nothing above may
        # have run — and COMPLAINTS_CLOSED still moved.
        evaluate_and_award(citizen_id=citizen.id, now=now)
        return load_complaint_detail(complaint_id=complaint.id)


# --- Door 6: POST /complaints/{id}/dispute ------------------------------------


def dispute_resolution(
    *, complaint_id: int, citizen: User, reason: str, photo: Any, now: datetime
) -> ComplaintDetailData:
    """RESOLVED -> REOPENED. Reason AND a fresh photo both required.

    The dispute photo is appended to `complaint_evidence` with
    the next sequence, and its `verdict` stays permanently null — it is never
    routed through an officer's evidence review. The admin judges it directly
    when ruling, and that ruling lives on status_history.

    The complaint STAYS in its cluster: `cluster_id` is never cleared, which is
    what stops a disputed-and-refixed member masquerading as a standalone +50.
    """
    evidence_rows = []
    try:
        with transaction():
            complaint = db.session.get(Complaint, complaint_id)
            if complaint is None:
                raise NotFoundError("No such complaint.")
            if complaint.citizen_id != citizen.id:
                raise ForbiddenError("You do not have access to this complaint.")
            raise_for(validate_dispute(complaint.status, reason, photo is not None))

            apply_transition(
                complaint_id=complaint.id,
                expected_status=ComplaintStatus.RESOLVED,
                new_status=ComplaintStatus.REOPENED,
                actor_role=StatusActor.CITIZEN,
                changed_by_user_id=citizen.id,
                now=now,
                reason=reason,
            )
            # The guarded transition must choose the winning request before an
            # evidence sequence is allocated. A storage/validation failure still
            # rolls this transition and its history row back atomically.
            evidence_rows = attach_photos(
                complaint_id=complaint.id,
                photos=[photo],
                now=now,
            )
            detail = load_complaint_detail(complaint_id=complaint.id)
    except Exception:
        for evidence in evidence_rows:
            remove_photo(
                file_path=evidence.file_path,
                upload_dir=current_app.config["UPLOAD_DIR"],
            )
        raise

    # Imported here, not at module scope — see the note in submission.py: this
    # module is the one `jobs/auto_close.py` must import back.
    from app.jobs.screening import submit_evidence_screening

    submit_evidence_screening(
        current_app._get_current_object(),
        [evidence.id for evidence in evidence_rows],
    )
    return detail


# --- Door 7: POST /admin/complaints/{id}/dispute-review -----------------------


def review_dispute(
    *,
    complaint_id: int,
    admin: User,
    verdict: DisputeVerdict,
    reason: str | None,
    now: datetime,
) -> Complaint:
    """The ONLY exit from REOPENED, and it belongs to the admin.

    TODO(phase 7).
      * UPHELD   -> IN_PROGRESS (back to the officer).
      * REJECTED -> CLOSED with ZERO points — same as an auto-close. A citizen
        must not be able to use a losing dispute to manufacture a second shot at
        the reward they gave up by disputing instead of confirming.
    """
    raise NotImplementedError


# --- Door 8: PATCH /admin/complaints/{id} -------------------------------------


def override(
    *,
    complaint_id: int,
    admin: User,
    new_status: ComplaintStatus | None,
    new_zone_id: int | None,
    reason: str,
    now: datetime,
) -> Complaint:
    """An admin may set any status — but the bookkeeping still happens.

    TODO(phase 7). In particular: if the target is in
    `domain.lifecycle.AT_OR_PAST_UNDER_REVIEW` and
    `domain.sla.needs_backfill(...)` is true, backfill `sla_target_hours` and
    `sla_started_at` as if a VALID verdict had fired, so `slaLabel` never comes
    back silently null on an overridden complaint.

    An override still writes its history row, with actor_role=ADMIN and the
    admin's reason.
    """
    raise NotImplementedError


# --- Door 10: the auto-close sweeper (SYSTEM) --------------------------------


def auto_close(*, complaint_id: int, now: datetime) -> Complaint:
    """RESOLVED -> CLOSED by the sweeper. ZERO points, actor_role=SYSTEM,
    changed_by_user_id=NULL.
    """
    return apply_transition(
        complaint_id=complaint_id,
        expected_status=ComplaintStatus.RESOLVED,
        new_status=ComplaintStatus.CLOSED,
        actor_role=StatusActor.SYSTEM,
        changed_by_user_id=None,
        now=now,
        remark="Auto-closed by system after confirmation window expired.",
        extra_values={"closed_at": now},
    )
