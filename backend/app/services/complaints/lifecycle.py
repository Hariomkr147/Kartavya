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

from sqlalchemy import select, update, desc

from app.domain.enums import (
    ComplaintStatus,
    DisputeVerdict,
    EvidenceVerdict,
    OfficerTargetStatus,
    StatusActor,
)
from app.domain.errors import ConflictError, NotFoundError, raise_for
from app.extensions import db
from app.models import Complaint, StatusHistory, User, ComplaintEvidence, ComplaintCategory, ComplaintNote
from app.domain import lifecycle, sla
from app.core import scoping
from app.services.complaints import clusters


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
    """SUBMITTED -> EVIDENCE_UNDER_REVIEW, setting assigned_officer_id."""
    complaint = db.session.execute(
        scoping.visible_complaints(officer).where(Complaint.id == complaint_id)
    ).scalar_one_or_none()
    
    if complaint is None:
        raise scoping.not_found()
        
    raise_for(lifecycle.validate_claim(complaint.status))
    
    return apply_transition(
        complaint_id=complaint_id,
        expected_status=ComplaintStatus.SUBMITTED,
        new_status=ComplaintStatus.EVIDENCE_UNDER_REVIEW,
        actor_role=StatusActor.OFFICER,
        changed_by_user_id=officer.id,
        now=now,
        extra_values={"assigned_officer_id": officer.id},
    )


# --- Door 2: POST /officer/complaints/{id}/evidence-review --------------------


def review_evidence(
    *,
    complaint_id: int,
    officer: User,
    verdict: EvidenceVerdict,
    reason: str | None,
    now: datetime,
) -> Complaint:
    """The photo verdict. Three outcomes, three different side effects."""
    complaint = db.session.execute(
        scoping.visible_complaints(officer).where(Complaint.id == complaint_id)
    ).scalar_one_or_none()
    
    if complaint is None:
        raise scoping.not_found()
        
    raise_for(
        lifecycle.validate_evidence_review(
            current=complaint.status,
            sla_started_at=complaint.sla_started_at,
            verdict=verdict,
            reason=reason,
        )
    )
    
    evidence = db.session.execute(
        select(ComplaintEvidence)
        .where(ComplaintEvidence.complaint_id == complaint_id)
        .where(ComplaintEvidence.verdict.is_(None))
        .order_by(desc(ComplaintEvidence.sequence))
    ).scalars().first()
    
    if evidence:
        evidence.verdict = verdict
        evidence.verdict_reason = reason
        evidence.reviewed_by = officer.id
        evidence.reviewed_at = now
        
    extra_values = {}
    new_status = lifecycle.VERDICT_TARGET[verdict]
    
    if verdict == EvidenceVerdict.VALID:
        category_sla_hours = db.session.execute(
            select(ComplaintCategory.sla_hours)
            .where(ComplaintCategory.id == complaint.category_id)
        ).scalar_one()
        
        target, started = sla.start(now, category_sla_hours)
        extra_values["sla_target_hours"] = target
        extra_values["sla_started_at"] = started
    elif verdict == EvidenceVerdict.NEEDS_MORE_EVIDENCE:
        new_pause = sla.pause(complaint.sla_started_at, now)
        if new_pause:
            extra_values["sla_paused_at"] = new_pause
    elif verdict == EvidenceVerdict.REJECTED:
        # Gamification: REJECTED on the evidence-review door costs 20 CSP
        from app.services.gamification.ledger import award_points
        award_points(
            user_id=complaint.citizen_id,
            reason="REJECTED_PENALTY",
            points=-20,
            reference_id=complaint_id,
            now=now
        )
        
    return apply_transition(
        complaint_id=complaint_id,
        expected_status=ComplaintStatus.EVIDENCE_UNDER_REVIEW,
        new_status=new_status,
        actor_role=StatusActor.OFFICER,
        changed_by_user_id=officer.id,
        now=now,
        reason=reason,
        extra_values=extra_values,
    )


def add_progress_note(
    *,
    complaint_id: int,
    officer: User,
    note_text: str,
    now: datetime,
) -> ComplaintNote:
    """Add a progress note, requiring the complaint to be IN_PROGRESS or UNDER_RESOLUTION."""
    complaint = db.session.execute(
        scoping.visible_complaints(officer).where(Complaint.id == complaint_id)
    ).scalar_one_or_none()
    
    if complaint is None:
        raise scoping.not_found()
        
    if complaint.status not in (ComplaintStatus.IN_PROGRESS, ComplaintStatus.UNDER_RESOLUTION):
        raise ConflictError(
            "INVALID_STATUS",
            "Notes can only be added when the complaint is in progress or under resolution."
        )
        
    note = ComplaintNote(
        complaint_id=complaint_id,
        officer_id=officer.id,
        note_text=note_text.strip(),
        created_at=now,
    )
    db.session.add(note)
    return note


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
    """The ordinary officer status move."""
    complaint = db.session.execute(
        scoping.visible_complaints(officer).where(Complaint.id == complaint_id)
    ).scalar_one_or_none()
    
    if complaint is None:
        raise scoping.not_found()
        
    raise_for(lifecycle.validate_officer_transition(complaint.status, target, reason))
    
    extra_values = {}
    if target == OfficerTargetStatus.RESOLVED:
        extra_values["resolved_at"] = now
    elif target == OfficerTargetStatus.NEEDS_MORE_EVIDENCE:
        extra_values["sla_paused_at"] = sla.pause(complaint.sla_started_at, now)
        
    new_status = ComplaintStatus(target.value)
        
    updated = apply_transition(
        complaint_id=complaint_id,
        expected_status=complaint.status,
        new_status=new_status,
        actor_role=StatusActor.OFFICER,
        changed_by_user_id=officer.id,
        now=now,
        reason=reason,
        remark=note.strip() if note and note.strip() else None,
        extra_values=extra_values,
    )
    
    cascade = []
    if target == OfficerTargetStatus.RESOLVED and updated.cluster_id:
        cascade = clusters.cascade_resolution(
            resolved=updated,
            now=now,
        )
        
    return TransitionResult(complaint=updated, cascade=cascade)


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


def confirm_resolution(*, complaint_id: int, citizen: User, now: datetime) -> Complaint:
    """RESOLVED -> CLOSED, and the ONLY path that credits confirm rewards.

    TODO(phase 6). Steps, all in one transaction:
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
    raise NotImplementedError


# --- Door 6: POST /complaints/{id}/dispute ------------------------------------


def dispute_resolution(
    *, complaint_id: int, citizen: User, reason: str, photo: Any, now: datetime
) -> Complaint:
    """RESOLVED -> REOPENED. Reason AND a fresh photo both required.

    TODO(phase 6). The dispute photo is appended to `complaint_evidence` with
    the next sequence, and its `verdict` stays permanently null — it is never
    routed through an officer's evidence review. The admin judges it directly
    when ruling, and that ruling lives on status_history.

    The complaint STAYS in its cluster: `cluster_id` is never cleared, which is
    what stops a disputed-and-refixed member masquerading as a standalone +50.
    """
    raise NotImplementedError


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

    TODO(phase 8). Called by `app/jobs/auto_close.py`, which opens its own
    session. Rewards flow only through an explicit citizen confirm — do not call
    the gamification services from here.
    """
    raise NotImplementedError
