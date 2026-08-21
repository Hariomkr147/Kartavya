"""The complaint state machine — every rule about which status may follow which.

Ported from `frontend/src/mocks/lib/fsm.ts`, which is the executable reference
implementation the finished frontend already runs against.

Nothing in this module touches a database, a clock, or Flask. Every check is a
pure function returning `Ok` or `Err`, so the hundreds of tests it deserves run
in milliseconds. The *side effects* of a transition (writing the row, the
history entry, the SLA columns, the cascade) belong to
`app/services/complaints/lifecycle.py` — the one place in the system allowed to
assign `complaint.status`.
"""

from __future__ import annotations

from datetime import datetime

from app.domain.enums import (
    ComplaintStatus,
    EvidenceVerdict,
    OfficerTargetStatus,
    TransitionFailureCode,
)
from app.domain.errors import Check, Err, Ok

S = ComplaintStatus

#: A complaint in one of these can never move again.
TERMINAL: frozenset[ComplaintStatus] = frozenset({S.REJECTED, S.CLOSED, S.UNRESOLVABLE})

#: Statuses that imply the SLA clock has legally started at some point.
#: Used by the admin override to decide whether to backfill the SLA snapshot.
AT_OR_PAST_UNDER_REVIEW: frozenset[ComplaintStatus] = frozenset(
    {
        S.UNDER_REVIEW,
        S.IN_PROGRESS,
        S.UNDER_RESOLUTION,
        S.RESOLVED,
        S.CLOSED,
        S.REOPENED,
        S.UNRESOLVABLE,
    }
)

#: For each officer-requestable target, the statuses it is legal to arrive from.
OFFICER_TRANSITIONS: dict[OfficerTargetStatus, frozenset[ComplaintStatus]] = {
    OfficerTargetStatus.IN_PROGRESS: frozenset({S.UNDER_REVIEW}),
    OfficerTargetStatus.UNDER_RESOLUTION: frozenset({S.IN_PROGRESS}),
    OfficerTargetStatus.RESOLVED: frozenset({S.UNDER_RESOLUTION}),
    OfficerTargetStatus.UNRESOLVABLE: frozenset(
        {S.UNDER_REVIEW, S.IN_PROGRESS, S.UNDER_RESOLUTION}
    ),
    # Post-acceptance recall only. The pre-acceptance route to this status is
    # the evidence-review door, and it pauses nothing (see §5.1 rule 3).
    OfficerTargetStatus.NEEDS_MORE_EVIDENCE: frozenset({S.UNDER_REVIEW}),
}

#: Targets that are meaningless without an explanation to the citizen.
REASON_REQUIRED: frozenset[OfficerTargetStatus] = frozenset(
    {OfficerTargetStatus.UNRESOLVABLE, OfficerTargetStatus.NEEDS_MORE_EVIDENCE}
)

#: The only sibling statuses a cluster resolution may sweep along.
#: Note what is absent: the evidence phase (the gate is never bypassed by riding
#: a cluster) and REOPENED (a pending dispute always waits for its admin).
CASCADE_ELIGIBLE: frozenset[ComplaintStatus] = frozenset(
    {S.UNDER_REVIEW, S.IN_PROGRESS, S.UNDER_RESOLUTION}
)

#: What each evidence verdict resolves to.
VERDICT_TARGET: dict[EvidenceVerdict, ComplaintStatus] = {
    EvidenceVerdict.VALID: S.UNDER_REVIEW,
    EvidenceVerdict.NEEDS_MORE_EVIDENCE: S.NEEDS_MORE_EVIDENCE,
    EvidenceVerdict.REJECTED: S.REJECTED,
}


def is_terminal(status: ComplaintStatus) -> bool:
    return status in TERMINAL


def is_cascade_eligible(status: ComplaintStatus) -> bool:
    return status in CASCADE_ELIGIBLE


def _blank(text: str | None) -> bool:
    return text is None or not text.strip()


# --- Door 1: POST /officer/complaints/{id}/claim ------------------------------


def validate_claim(current: ComplaintStatus) -> Check:
    """Only door out of SUBMITTED. Sets assigned_officer_id in the same step.

    The service must still apply this as `UPDATE ... WHERE status='SUBMITTED'`:
    this check alone cannot stop two officers claiming the same complaint at the
    same moment. `rowcount` is what actually decides. See architecture §6.3.
    """
    if current is not S.SUBMITTED:
        return Err(
            TransitionFailureCode.INVALID_TRANSITION,
            "This complaint has already been picked up.",
        )
    return Ok()


# --- Door 2: POST /officer/complaints/{id}/evidence-review --------------------


def validate_evidence_review(
    current: ComplaintStatus,
    sla_started_at: datetime | None,
    verdict: EvidenceVerdict,
    reason: str | None,
) -> Check:
    """Judge a photo.

    `sla_started_at` being set means this complaint has already been accepted
    once, which is exactly what makes REJECTED illegal here: the complaint was
    validated before and may be actively being worked, so declaring it fake now
    would be a false accusation carrying a real -20 point penalty.
    """
    if current is not S.EVIDENCE_UNDER_REVIEW:
        return Err(
            TransitionFailureCode.INVALID_TRANSITION,
            "This complaint is not at the evidence-review stage.",
        )
    if verdict is EvidenceVerdict.REJECTED and sla_started_at is not None:
        return Err(
            TransitionFailureCode.INVALID_TRANSITION,
            "This complaint already passed its first evidence round — it can only be "
            "accepted or sent back for more evidence now, not rejected.",
        )
    if verdict in (EvidenceVerdict.NEEDS_MORE_EVIDENCE, EvidenceVerdict.REJECTED) and _blank(
        reason
    ):
        return Err(
            "VALIDATION_ERROR",
            f"A reason is required when the verdict is {verdict}.",
            http_status=400,
        )
    return Ok()


# --- Doors 3 & 4: PATCH .../status and POST .../batch-status ------------------


def validate_officer_transition(
    current: ComplaintStatus,
    target: OfficerTargetStatus,
    reason: str | None,
) -> Check:
    """One item of an officer status update.

    Returns rather than raises so the batch door can report a per-complaint
    `TransitionFailureCode` inside a 200 response.
    """
    if current not in OFFICER_TRANSITIONS[target]:
        return Err(
            TransitionFailureCode.INVALID_TRANSITION,
            f"Cannot move from {current} to {target}.",
        )
    if target in REASON_REQUIRED and _blank(reason):
        return Err(
            TransitionFailureCode.REASON_REQUIRED,
            f"A reason is required when moving to {target}.",
            http_status=400,
        )
    return Ok()


# --- Door 5: POST /complaints/{id}/confirm ------------------------------------


def validate_confirm(current: ComplaintStatus) -> Check:
    """A citizen may only confirm a fix that has actually been reported fixed."""
    if current is not S.RESOLVED:
        return Err(
            TransitionFailureCode.INVALID_TRANSITION,
            "Only a resolved complaint can be confirmed.",
        )
    return Ok()


# --- Door 6: POST /complaints/{id}/dispute ------------------------------------


def validate_dispute(current: ComplaintStatus, reason: str | None, has_photo: bool) -> Check:
    """Disputing costs the citizen a reason *and* a fresh photo — burden of proof.

    Valid only while RESOLVED. A citizen who lets the auto-close timeout elapse
    loses the option, which is why that timeout defaults to a generous 168 h.
    """
    if current is not S.RESOLVED:
        return Err(
            TransitionFailureCode.INVALID_TRANSITION,
            "Only a resolved complaint can be disputed.",
        )
    if _blank(reason):
        return Err("VALIDATION_ERROR", "A reason is required to dispute a fix.", http_status=400)
    if not has_photo:
        return Err(
            "VALIDATION_ERROR",
            "A new photo is required to dispute a fix.",
            http_status=400,
        )
    return Ok()


# --- Door 7: POST /admin/complaints/{id}/dispute-review -----------------------


def validate_dispute_review(current: ComplaintStatus) -> Check:
    """The ONLY exit from REOPENED, and it belongs to the admin.

    Not the status door, not the batch door, not the cascade. All three of those
    must actively refuse REOPENED — which they do, because REOPENED is absent
    from every set in OFFICER_TRANSITIONS and from CASCADE_ELIGIBLE.
    """
    if current is not S.REOPENED:
        return Err(
            TransitionFailureCode.INVALID_TRANSITION,
            "Only a reopened complaint awaits a dispute ruling.",
        )
    return Ok()


# --- Citizen evidence re-submission (no status door of its own) ---------------


def validate_evidence_resubmission(current: ComplaintStatus) -> Check:
    """POST /complaints/{id}/evidence — sends NEEDS_MORE_EVIDENCE back for review.

    Resumes the SLA clock if it had already started (see domain/sla.py).
    """
    if current is not S.NEEDS_MORE_EVIDENCE:
        return Err(
            TransitionFailureCode.INVALID_TRANSITION,
            "This complaint is not waiting for more evidence.",
        )
    return Ok()


# --- Door 8: PATCH /admin/complaints/{id} -------------------------------------


def validate_admin_override(target: ComplaintStatus) -> Check:
    """An admin may set any status. This exists so the door is explicit.

    The override is not a free pass on bookkeeping: the service still writes the
    history row and still backfills the SLA snapshot when the target is
    UNDER_REVIEW or later and the clock never started. See domain/sla.py.
    """
    if target not in set(ComplaintStatus):  # pragma: no cover - enum-guarded upstream
        return Err("VALIDATION_ERROR", f"Unknown status {target}.", http_status=400)
    return Ok()
