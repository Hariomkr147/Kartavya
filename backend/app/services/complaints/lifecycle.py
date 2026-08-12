"""THE single choke point for every status write in the system.

    No other module may assign to `complaint.status`. Not the officer routes,
    not the admin routes, not the cascade, not the sweeper. All of them call
    into here.

Because the `status_history` row is written inside `apply_transition()`, a
status change without a matching audit entry is structurally impossible. If you
find yourself typing `complaint.status = ...` anywhere else in this codebase,
stop â€” that is precisely the bug this design exists to prevent.

The pure rules ("is this legal?") live in `app/domain/lifecycle.py`. This module
owns the *side effects*: the guarded UPDATE, the history row, the SLA columns,
the cascade, and the points.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from flask import current_app
from sqlalchemy import desc, select, update

from app.core import scoping
from app.core.auth import require_officer_zone
from app.core.session import savepoint, transaction
from app.domain import lifecycle, sla
from app.domain.enums import (
    ComplaintStatus,
    DisputeVerdict,
    EvidenceVerdict,
    OfficerTargetStatus,
    PointsReason,
    StatusActor,
)
from app.domain.errors import (
    ConflictError,
    Err,
    ForbiddenError,
    NotFoundError,
    ValidationError,
    raise_for,
)
from app.domain.lifecycle import (
    AT_OR_PAST_UNDER_REVIEW,
    TERMINAL,
    validate_admin_override,
    validate_confirm,
    validate_dispute,
    validate_dispute_review,
)
from app.domain.points import close_reward, earns_on_time_bonus
from app.domain.sla import label as sla_label
from app.domain.sla import needs_backfill, start
from app.extensions import db
from app.infra.storage import remove_photo
from app.models import (
    Complaint,
    ComplaintCategory,
    ComplaintCluster,
    ComplaintEvidence,
    ComplaintNote,
    StatusHistory,
    User,
    Zone,
)
from app.services.complaints import clusters
from app.services.complaints.clusters import (
    citizen_already_rewarded_in_cluster,
    claim_cluster_reward,
    detach_for_admin_reclassification,
    link_new_complaint,
)
from app.services.complaints.evidence import attach_photos
from app.services.complaints.views import ComplaintDetailData, load_complaint_detail
from app.services.gamification.badges import evaluate_and_award
from app.services.gamification.ledger import award


@dataclass
class TransitionResult:
    """What a door returns to its route. `cascade` is empty unless a cluster moved.

    `detail` carries the fully preloaded rows (evidence, history, notes) rather
    than a bare `Complaint`, because the contract's 200 for these endpoints is a
    ComplaintDetail — and a serializer is not allowed to go and fetch them
    itself (architecture §3.3 rule 3).
    """

    detail: ComplaintDetailData
    cascade: list[dict[str, Any]]

    @property
    def complaint(self) -> Complaint:
        return self.detail.complaint


@dataclass(frozen=True)
class ProgressNoteResult:
    """Committed-note response data, detached from ORM session refreshes."""

    id: int
    officer_id: int
    note_text: str
    created_at: datetime


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
    gets 0 and a clean 409 â€” which is what the contract specifies for a
    contested claim.

    Args:
        expected_status: the status(es) this move is legal from. Becomes the
            guard. Pass a set for doors with several legal sources (e.g.
            UNRESOLVABLE).
        extra_values: additional columns to set in the SAME statement â€” e.g.
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
            "This complaint has already moved on â€” reload it and try again.",
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
    """Append one audit row. INSERT only â€” there is no update path, ever.

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


def claim(*, complaint_id: int, officer: User, now: datetime) -> ComplaintDetailData:
    """SUBMITTED -> EVIDENCE_UNDER_REVIEW, setting assigned_officer_id."""
    with transaction():
        complaint = db.session.execute(
            scoping.visible_complaints(officer).where(Complaint.id == complaint_id)
        ).scalar_one_or_none()

        if complaint is None:
            raise scoping.not_found()

        raise_for(lifecycle.validate_claim(complaint.status))

        apply_transition(
            complaint_id=complaint_id,
            expected_status=ComplaintStatus.SUBMITTED,
            new_status=ComplaintStatus.EVIDENCE_UNDER_REVIEW,
            actor_role=StatusActor.OFFICER,
            changed_by_user_id=officer.id,
            now=now,
            extra_values={"assigned_officer_id": officer.id},
        )
        return load_complaint_detail(complaint_id=complaint_id)


# --- Door 2: POST /officer/complaints/{id}/evidence-review --------------------


def review_evidence(
    *,
    complaint_id: int,
    officer: User,
    verdict: EvidenceVerdict,
    reason: str | None,
    now: datetime,
) -> ComplaintDetailData:
    """The photo verdict. Three outcomes, three different side effects."""
    with transaction():
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

        evidence = (
            db.session.execute(
                select(ComplaintEvidence)
                .where(ComplaintEvidence.complaint_id == complaint_id)
                .where(ComplaintEvidence.verdict.is_(None))
                .order_by(desc(ComplaintEvidence.sequence))
            )
            .scalars()
            .first()
        )

        if evidence:
            evidence.verdict = verdict
            evidence.verdict_reason = reason
            evidence.reviewed_by = officer.id
            evidence.reviewed_at = now

        extra_values = {}
        new_status = lifecycle.VERDICT_TARGET[verdict]

        if verdict == EvidenceVerdict.VALID:
            # ONLY the first acceptance starts the clock. A VALID verdict is also
            # how a complaint comes back from an officer's post-acceptance recall
            # (UNDER_REVIEW -> NEEDS_MORE_EVIDENCE -> citizen re-uploads -> here),
            # and that second one RESUMES — `resubmit_evidence` already folded the
            # paused span into `sla_paused_seconds` on the way in.
            #
            # Restarting here instead would be wrong three times over: the officer
            # could zero a nearly-overdue deadline by asking for another photo;
            # the paused span would be excluded twice (once by the later start,
            # again by sla_paused_seconds) so every SLA-derived figure would read
            # short by exactly that span; and re-reading sla_hours would break the
            # frozen-at-acceptance snapshot that survives an admin's SLA edit.
            #
            # Mirrors `wasFirstAcceptance` in the reference implementation,
            # frontend/src/mocks/handlers/officer.ts.
            if complaint.sla_started_at is None:
                category_sla_hours = db.session.execute(
                    select(ComplaintCategory.sla_hours).where(
                        ComplaintCategory.id == complaint.category_id
                    )
                ).scalar_one()

                target, started = sla.start(now, category_sla_hours)
                extra_values["sla_target_hours"] = target
                extra_values["sla_started_at"] = started
        elif verdict == EvidenceVerdict.NEEDS_MORE_EVIDENCE:
            new_pause = sla.pause(complaint.sla_started_at, now)
            if new_pause:
                extra_values["sla_paused_at"] = new_pause
        elif verdict == EvidenceVerdict.REJECTED:
            # Rejecting evidence as fake/invalid costs the reporter 20 CSP. The
            # amount lives in domain/points.py, not here — `award` prices the row
            # from the reason so the penalty cannot drift from the contract.
            award(
                citizen_id=complaint.citizen_id,
                complaint_id=complaint_id,
                reason=PointsReason.REJECTED_PENALTY,
                now=now,
            )

        apply_transition(
            complaint_id=complaint_id,
            expected_status=ComplaintStatus.EVIDENCE_UNDER_REVIEW,
            new_status=new_status,
            actor_role=StatusActor.OFFICER,
            changed_by_user_id=officer.id,
            now=now,
            reason=reason,
            extra_values=extra_values,
        )
        return load_complaint_detail(complaint_id=complaint_id)


def add_progress_note(
    *,
    complaint_id: int,
    officer: User,
    note_text: str,
    now: datetime,
) -> ProgressNoteResult:
    """Add a progress note, requiring the complaint to be IN_PROGRESS or UNDER_RESOLUTION."""
    with transaction():
        note = _add_progress_note(
            complaint_id=complaint_id, officer=officer, note_text=note_text, now=now
        )
        db.session.flush()
        return ProgressNoteResult(
            id=note.id,
            officer_id=note.officer_id,
            note_text=note.note_text,
            created_at=note.created_at,
        )


def _add_progress_note(
    *, complaint_id: int, officer: User, note_text: str, now: datetime
) -> ComplaintNote:
    complaint = db.session.execute(
        scoping.visible_complaints(officer).where(Complaint.id == complaint_id)
    ).scalar_one_or_none()

    if complaint is None:
        raise scoping.not_found()

    if complaint.status not in (ComplaintStatus.IN_PROGRESS, ComplaintStatus.UNDER_RESOLUTION):
        raise ConflictError(
            "INVALID_STATUS",
            "Notes can only be added when the complaint is in progress or under resolution.",
        )

    note = ComplaintNote(
        complaint_id=complaint_id,
        officer_id=officer.id,
        note_text=note_text.strip(),
        created_at=now,
    )
    db.session.add(note)
    return note


def add_cluster_progress_notes(
    *, cluster_id: int, officer: User, note_text: str, now: datetime
) -> list[ProgressNoteResult]:
    with transaction():
        notes = _add_cluster_progress_notes(
            cluster_id=cluster_id, officer=officer, note_text=note_text, now=now
        )
        db.session.flush()
        return [
            ProgressNoteResult(
                id=note.id,
                officer_id=note.officer_id,
                note_text=note.note_text,
                created_at=note.created_at,
            )
            for note in notes
        ]


def _add_cluster_progress_notes(
    *, cluster_id: int, officer: User, note_text: str, now: datetime
) -> list[ComplaintNote]:
    cluster = db.session.get(ComplaintCluster, cluster_id)
    if cluster is None:
        raise scoping.not_found("cluster")
    scoping.assert_can_view_zone(officer, cluster.zone_id)

    eligible = (
        db.session.execute(
            select(Complaint)
            .where(
                Complaint.cluster_id == cluster.id,
                Complaint.status.in_(
                    {ComplaintStatus.IN_PROGRESS, ComplaintStatus.UNDER_RESOLUTION}
                ),
            )
            .order_by(Complaint.id)
        )
        .scalars()
        .all()
    )
    if not eligible:
        raise ConflictError(
            "INVALID_TRANSITION",
            "No complaint in this cluster is IN_PROGRESS or UNDER_RESOLUTION.",
        )

    notes = [
        ComplaintNote(
            complaint_id=complaint.id,
            officer_id=officer.id,
            note_text=note_text.strip(),
            created_at=now,
        )
        for complaint in eligible
    ]
    db.session.add_all(notes)
    return notes


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
    with transaction():
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

        return TransitionResult(
            detail=load_complaint_detail(complaint_id=complaint_id),
            cascade=cascade,
        )


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

    Semantics that differ from every other door:
      * Validate all -> apply the valid ones -> ONE commit.
      * Per-item failures are `TransitionFailureCode` values inside the 200
        body, not rollbacks and not 4xx.
      * An unknown complaint ID is a per-item UNKNOWN_COMPLAINT. An unknown
        `clusterId` IS a 404. That difference is deliberate.
      * Exactly one of `complaint_ids` / `cluster_id` â€” the schema's `oneOf`
        makes both-or-neither a 400 before it reaches here.
      * Wrap each item in `core.session.savepoint()` so one item's database
        error cannot poison the batch.
    """
    with transaction():
        return _transition_batch(
            officer=officer,
            complaint_ids=complaint_ids,
            cluster_id=cluster_id,
            target=target,
            reason=reason,
            note=note,
            now=now,
        )


def _transition_batch(
    *,
    officer: User,
    complaint_ids: list[int] | None,
    cluster_id: int | None,
    target: OfficerTargetStatus,
    reason: str | None,
    note: str | None,
    now: datetime,
) -> dict[str, Any]:
    officer_zone_id = require_officer_zone(officer)

    if cluster_id is not None:
        cluster = db.session.get(ComplaintCluster, cluster_id)
        if cluster is None:
            raise scoping.not_found("cluster")
        scoping.assert_can_view_zone(officer, cluster.zone_id)
        complaints = (
            db.session.execute(
                select(Complaint).where(Complaint.cluster_id == cluster.id).order_by(Complaint.id)
            )
            .scalars()
            .all()
        )
        requested_ids = [complaint.id for complaint in complaints]
    else:
        requested_ids = complaint_ids or []
        complaints = (
            db.session.execute(select(Complaint).where(Complaint.id.in_(set(requested_ids))))
            .scalars()
            .all()
        )
    by_id = {complaint.id: complaint for complaint in complaints}

    results: list[dict[str, Any]] = []
    valid: list[tuple[int, ComplaintStatus, int]] = []
    for index, complaint_id in enumerate(requested_ids):
        complaint = by_id.get(complaint_id)
        if complaint is None:
            results.append(
                {
                    "complaintId": str(complaint_id),
                    "success": False,
                    "status": None,
                    "previousStatus": None,
                    "errorCode": "UNKNOWN_COMPLAINT",
                    "errorMessage": "No such complaint.",
                }
            )
            continue

        previous = complaint.status
        if complaint.zone_id != officer_zone_id:
            results.append(
                {
                    "complaintId": str(complaint_id),
                    "success": False,
                    "status": None,
                    "previousStatus": previous.value,
                    "errorCode": "NOT_IN_ZONE",
                    "errorMessage": "This complaint is outside your assigned zone.",
                }
            )
            continue

        check = lifecycle.validate_officer_transition(previous, target, reason)
        if isinstance(check, Err):
            results.append(
                {
                    "complaintId": str(complaint_id),
                    "success": False,
                    "status": None,
                    "previousStatus": previous.value,
                    "errorCode": str(check.code),
                    "errorMessage": check.message,
                }
            )
            continue

        results.append({})
        valid.append((complaint_id, previous, index))

    for complaint_id, previous, index in valid:
        extra_values: dict[str, Any] = {}
        if target == OfficerTargetStatus.RESOLVED:
            extra_values["resolved_at"] = now
        elif target == OfficerTargetStatus.NEEDS_MORE_EVIDENCE:
            extra_values["sla_paused_at"] = sla.pause(by_id[complaint_id].sla_started_at, now)

        try:
            with savepoint():
                apply_transition(
                    complaint_id=complaint_id,
                    expected_status=previous,
                    new_status=ComplaintStatus(target.value),
                    actor_role=StatusActor.OFFICER,
                    changed_by_user_id=officer.id,
                    now=now,
                    reason=reason.strip() if reason and reason.strip() else None,
                    remark=note.strip() if note and note.strip() else None,
                    extra_values=extra_values,
                )
            results[index] = {
                "complaintId": str(complaint_id),
                "success": True,
                "status": target.value,
                "previousStatus": previous.value,
                "errorCode": None,
                "errorMessage": None,
            }
        except ConflictError as exc:
            results[index] = {
                "complaintId": str(complaint_id),
                "success": False,
                "status": None,
                "previousStatus": previous.value,
                "errorCode": "INVALID_TRANSITION",
                "errorMessage": exc.message,
            }

    succeeded = sum(1 for result in results if result["success"])
    return {
        "results": results,
        "summary": {
            "requested": len(results),
            "succeeded": succeeded,
            "failed": len(results) - succeeded,
        },
    }


# --- Door 5: POST /complaints/{id}/confirm ------------------------------------


def confirm_resolution(*, complaint_id: int, citizen: User, now: datetime) -> ComplaintDetailData:
    """RESOLVED -> CLOSED, and the ONLY path that credits confirm rewards.

    Steps, all in one transaction:
      1. Ownership check (a citizen confirms their own complaint only).
      2. `domain.lifecycle.validate_confirm(current)`.
      3. `apply_transition(expected_status=RESOLVED, new_status=CLOSED,
         extra_values={"closed_at": now})` â€” the guard is what makes a
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
            # one-time +50 on their way to earning nothing â€” which would silently
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
        # have run â€” and COMPLAINTS_CLOSED still moved.
        evaluate_and_award(citizen_id=citizen.id, now=now)
        return load_complaint_detail(complaint_id=complaint.id)


# --- Door 6: POST /complaints/{id}/dispute ------------------------------------


def dispute_resolution(
    *, complaint_id: int, citizen: User, reason: str, photo: Any, now: datetime
) -> ComplaintDetailData:
    """RESOLVED -> REOPENED. Reason AND a fresh photo both required.

    The dispute photo is appended to `complaint_evidence` with
    the next sequence, and its `verdict` stays permanently null â€” it is never
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

    # Imported here, not at module scope â€” see the note in submission.py: this
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

      * UPHELD   -> IN_PROGRESS (back to the officer).
      * REJECTED -> CLOSED with ZERO points — same as an auto-close. A citizen
        must not be able to use a losing dispute to manufacture a second shot at
        the reward they gave up by disputing instead of confirming.
    """
    with transaction():
        complaint = db.session.get(Complaint, complaint_id)
        if complaint is None:
            raise NotFoundError("No such complaint.")
        raise_for(validate_dispute_review(complaint.status))
        target = (
            ComplaintStatus.IN_PROGRESS
            if verdict is DisputeVerdict.UPHELD
            else ComplaintStatus.CLOSED
        )
        extra_values = {"closed_at": now} if target is ComplaintStatus.CLOSED else None
        return apply_transition(
            complaint_id=complaint.id,
            expected_status=ComplaintStatus.REOPENED,
            new_status=target,
            actor_role=StatusActor.ADMIN,
            changed_by_user_id=admin.id,
            now=now,
            reason=reason,
            extra_values=extra_values,
        )


# --- Door 8: PATCH /admin/complaints/{id} -------------------------------------


def override(
    *,
    complaint_id: int,
    admin: User,
    new_status: ComplaintStatus | None,
    new_zone_id: int | None,
    new_category_id: int | None,
    reason: str | None,
    now: datetime,
    cluster_radius_meters: float,
) -> Complaint:
    """An admin may set any status — but the bookkeeping still happens.

    In particular: if the target is in
    `domain.lifecycle.AT_OR_PAST_UNDER_REVIEW` and
    `domain.sla.needs_backfill(...)` is true, backfill `sla_target_hours` and
    `sla_started_at` as if a VALID verdict had fired, so `slaLabel` never comes
    back silently null on an overridden complaint.

    An override still writes its history row, with actor_role=ADMIN and the
    admin's reason.
    """
    with transaction():
        complaint = db.session.get(Complaint, complaint_id)
        if complaint is None:
            raise NotFoundError("No such complaint.")

        category = (
            db.session.get(ComplaintCategory, new_category_id)
            if new_category_id is not None
            else db.session.get(ComplaintCategory, complaint.category_id)
        )
        if category is None:
            raise ValidationError("categoryId does not refer to a known category.")
        if new_zone_id is not None and db.session.get(Zone, new_zone_id) is None:
            raise ValidationError("zoneId does not refer to a known zone.")

        classification_changed = (
            new_category_id is not None and new_category_id != complaint.category_id
        ) or (new_zone_id is not None and new_zone_id != complaint.zone_id)
        status_changed = new_status is not None and new_status != complaint.status
        if not classification_changed and not status_changed and not (reason or "").strip():
            raise ValidationError(
                "Send at least one of status, categoryId, zoneId, or a reason to record."
            )

        if classification_changed:
            detach_for_admin_reclassification(complaint=complaint, now=now)
        if new_category_id is not None:
            complaint.category_id = new_category_id
        if new_zone_id is not None:
            complaint.zone_id = new_zone_id
        if classification_changed:
            db.session.flush()
            link_new_complaint(
                complaint=complaint,
                radius_meters=cluster_radius_meters,
                now=now,
            )

        target_status = new_status or complaint.status
        raise_for(validate_admin_override(target_status))
        extra_values: dict[str, Any] = {}
        if new_status in AT_OR_PAST_UNDER_REVIEW and needs_backfill(
            complaint.sla_target_hours, complaint.sla_started_at
        ):
            target_hours, started_at = start(now, category.sla_hours)
            extra_values.update({"sla_target_hours": target_hours, "sla_started_at": started_at})
        if status_changed and target_status is ComplaintStatus.RESOLVED:
            extra_values["resolved_at"] = now
        if status_changed and target_status is ComplaintStatus.CLOSED:
            extra_values["closed_at"] = now
        if (
            new_zone_id is not None
            and target_status not in TERMINAL
            and complaint.assigned_officer_id is not None
        ):
            assigned = db.session.get(User, complaint.assigned_officer_id)
            if assigned is None or assigned.zone_id != complaint.zone_id:
                extra_values["assigned_officer_id"] = None
        return apply_transition(
            complaint_id=complaint.id,
            expected_status=complaint.status,
            new_status=target_status,
            actor_role=StatusActor.ADMIN,
            changed_by_user_id=admin.id,
            now=now,
            reason=reason,
            extra_values=extra_values,
        )


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
