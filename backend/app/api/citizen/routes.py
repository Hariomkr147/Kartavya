"""Citizen-facing endpoints: complaints, the feed, points, badges, leaderboard.

A citizen sees only their own data plus the anonymized public feed. Nothing here
may expose another citizen's identity, and nothing here may cross a zone.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from shutil import copyfileobj
from uuid import uuid4

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import func, select

from app.api.shared.responses import todo
from app.core.auth import current_user, require_auth, require_role
from app.core.signing import sign_photo_url
from app.domain.enums import (
    AiScreenStatus,
    ComplaintStatus,
    PointsReason,
    StatusActor,
    UserRole,
)
from app.domain.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError, raise_for
from app.domain.lifecycle import (
    validate_confirm,
    validate_dispute,
    validate_evidence_resubmission,
)
from app.domain.points import close_reward, earns_on_time_bonus
from app.domain.severity import label as severity_label
from app.domain.severity import score as severity_score
from app.domain.sla import label as sla_label
from app.domain.sla import resume as resume_sla
from app.extensions import db
from app.models import (
    Complaint,
    ComplaintCategory,
    ComplaintCluster,
    ComplaintEvidence,
    ComplaintNote,
    ComplaintUpvote,
    PointsLedger,
    StatusHistory,
    User,
    Zone,
)

bp = Blueprint("citizen", __name__)

CITIZEN = UserRole.CITIZEN
_MAGIC_BYTES: dict[str, bytes] = {
    "image/jpeg": b"\xff\xd8\xff",
    "image/png": b"\x89PNG\r\n\x1a\n",
}


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _parse_complaint_id(complaint_id: str) -> int:
    try:
        return int(complaint_id)
    except ValueError as exc:
        raise NotFoundError("No such complaint.") from exc


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z")


def _detect_mime(head: bytes) -> str | None:
    for mime, prefix in _MAGIC_BYTES.items():
        if head.startswith(prefix):
            return mime
    return None


def _validate_and_store_photo(*, complaint_id: int, storage) -> str:
    if storage is None:
        raise ValidationError("A photo is required.")

    stream = storage.stream
    head = stream.read(max(len(prefix) for prefix in _MAGIC_BYTES.values()))
    mime_type = _detect_mime(head)
    stream.seek(0)
    if mime_type is None:
        raise ValidationError("Only JPEG and PNG photos are accepted.")

    payload = stream.read(current_app.config["MAX_UPLOAD_BYTES"] + 1)
    stream.seek(0)
    if len(payload) > current_app.config["MAX_UPLOAD_BYTES"]:
        raise ValidationError("Photo exceeds the 5 MB upload limit.")

    extension = ".jpg" if mime_type == "image/jpeg" else ".png"
    upload_root = Path(current_app.config["UPLOAD_DIR"])
    complaint_dir = upload_root / str(complaint_id)
    complaint_dir.mkdir(parents=True, exist_ok=True)
    target = complaint_dir / f"{uuid4().hex}{extension}"

    with target.open("wb") as handle:
        copyfileobj(stream, handle)
    stream.seek(0)
    return target.relative_to(upload_root).as_posix()


def _next_evidence_sequence(complaint_id: int) -> int:
    current = db.session.execute(
        select(func.max(ComplaintEvidence.sequence)).where(ComplaintEvidence.complaint_id == complaint_id)
    ).scalar_one()
    return int(current or 0) + 1


def _owned_complaint(complaint_id: int, citizen: User) -> Complaint:
    complaint = db.session.get(Complaint, complaint_id)
    if complaint is None:
        raise NotFoundError("No such complaint.")
    if complaint.citizen_id != citizen.id:
        raise ForbiddenError("You do not have access to this complaint.")
    return complaint


def _category_payload(category: ComplaintCategory) -> dict[str, object]:
    return {
        "id": str(category.id),
        "code": category.category_code,
        "name": category.category_name,
        "description": category.description,
        "slaTargetHours": category.sla_hours,
    }


def _zone_payload(zone: Zone) -> dict[str, object]:
    return {
        "id": str(zone.id),
        "code": zone.zone_code,
        "name": zone.zone_name,
        "isCatchAll": zone.is_catch_all,
        "isActive": zone.is_active,
    }


def _citizen_action_needed(status: ComplaintStatus) -> str | None:
    if status is ComplaintStatus.RESOLVED:
        return "CONFIRM_FIX"
    if status is ComplaintStatus.NEEDS_MORE_EVIDENCE:
        return "PROVIDE_MORE_EVIDENCE"
    return None


def _serialize_evidence(evidence: ComplaintEvidence) -> dict[str, object]:
    return {
        "id": str(evidence.id),
        "photoUrl": sign_photo_url(evidence.id),
        "sequence": evidence.sequence,
        "aiConfidenceNote": {
            "aiAvailable": evidence.ai_screen_status != AiScreenStatus.UNAVAILABLE,
            "matchesCategory": evidence.ai_matches_category,
            "confidence": evidence.ai_confidence,
            "note": evidence.ai_note,
        },
        "verdict": evidence.verdict.value if evidence.verdict else None,
        "verdictReason": evidence.verdict_reason,
        "reviewedByOfficerId": str(evidence.reviewed_by) if evidence.reviewed_by else None,
        "reviewedAt": _iso(evidence.reviewed_at),
        "submittedAt": _iso(evidence.created_at),
    }


def _serialize_status_history(entry: StatusHistory) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": str(entry.id),
        "fromStatus": entry.from_status.value if entry.from_status else None,
        "toStatus": entry.to_status.value,
        "changedByRole": entry.actor_role.value,
        "reason": entry.reason,
        "remark": entry.remark,
        "timestamp": _iso(entry.created_at),
    }
    if entry.actor_role is StatusActor.OFFICER and entry.changed_by_user_id is not None:
        payload["changedByOfficerId"] = str(entry.changed_by_user_id)
    return payload


def _serialize_progress_note(note: ComplaintNote) -> dict[str, object]:
    return {
        "id": str(note.id),
        "officerId": str(note.officer_id),
        "text": note.note_text,
        "createdAt": _iso(note.created_at),
    }


def _serialize_complaint_detail(complaint: Complaint, *, now: datetime) -> dict[str, object]:
    category = db.session.get(ComplaintCategory, complaint.category_id)
    zone = db.session.get(Zone, complaint.zone_id)
    if category is None or zone is None:
        raise NotFoundError("Complaint reference data is missing.")

    evidence_rows = list(complaint.evidence)
    first_evidence = evidence_rows[0] if evidence_rows else None
    upvote_count = db.session.execute(
        select(func.count(ComplaintUpvote.id)).where(ComplaintUpvote.complaint_id == complaint.id)
    ).scalar_one()
    history_rows = db.session.execute(
        select(StatusHistory)
        .where(StatusHistory.complaint_id == complaint.id)
        .order_by(StatusHistory.created_at.asc(), StatusHistory.id.asc())
    ).scalars().all()
    note_rows = db.session.execute(
        select(ComplaintNote)
        .where(ComplaintNote.complaint_id == complaint.id)
        .order_by(ComplaintNote.created_at.asc(), ComplaintNote.id.asc())
    ).scalars().all()

    payload: dict[str, object] = {
        "id": str(complaint.id),
        "category": _category_payload(category),
        "status": complaint.status.value,
        "severityLabel": severity_label(complaint.severity_score).value,
        "slaLabel": (
            sla_label(
                complaint.sla_target_hours,
                complaint.sla_started_at,
                complaint.sla_paused_seconds,
                complaint.sla_paused_at,
                now,
            ).value
            if sla_label(
                complaint.sla_target_hours,
                complaint.sla_started_at,
                complaint.sla_paused_seconds,
                complaint.sla_paused_at,
                now,
            )
            else None
        ),
        "upvoteCount": int(upvote_count),
        "photoUrl": sign_photo_url(first_evidence.id) if first_evidence else None,
        "zoneId": str(zone.id),
        "zoneName": zone.zone_name,
        "assignedOfficerId": str(complaint.assigned_officer_id) if complaint.assigned_officer_id else None,
        "createdAt": _iso(complaint.created_at),
        "updatedAt": _iso(complaint.updated_at),
        "citizenActionNeeded": _citizen_action_needed(complaint.status),
        "description": complaint.description,
        "latitude": complaint.latitude,
        "longitude": complaint.longitude,
        "severityScore": complaint.severity_score,
        "slaTargetHours": complaint.sla_target_hours,
        "clusterId": str(complaint.cluster_id) if complaint.cluster_id else None,
        "evidence": [_serialize_evidence(row) for row in evidence_rows],
        "statusHistory": [_serialize_status_history(row) for row in history_rows],
        "progressNotes": [_serialize_progress_note(row) for row in note_rows],
    }
    return payload


def _record_history(
    *,
    complaint_id: int,
    from_status: ComplaintStatus,
    to_status: ComplaintStatus,
    actor_role: StatusActor,
    changed_by_user_id: int,
    now: datetime,
    reason: str | None = None,
) -> None:
    db.session.add(
        StatusHistory(
            complaint_id=complaint_id,
            from_status=from_status,
            to_status=to_status,
            actor_role=actor_role,
            changed_by_user_id=changed_by_user_id,
            reason=reason,
            created_at=now,
        )
    )


# --- Complaints ---------------------------------------------------------------


@bp.post("/complaints")
@require_role(CITIZEN)
def create_complaint():
    """201 ComplaintDetail. multipart/form-data: 1-3 photos + fields.

    TODO(phase 3): `services.complaints.submission.create_complaint(...)`.

    `zoneId` is REQUIRED and trusted — the server never routes by location. The
    citizen confirmed the zone, either from photo EXIF GPS via /zones/suggest or
    by picking manually.

    AI screening is fired per photo and must NEVER block this 201.
    """
    todo("Complaint creation")


@bp.get("/complaints/my")
@require_role(CITIZEN)
def get_my_complaints():
    """200 ComplaintListResponse — the citizen dashboard.

    TODO(phase 3). Scoped by `core.scoping.visible_complaints`, which for a
    citizen means `citizen_id == me`.
    """
    todo("My complaints")


@bp.get("/complaints/<complaint_id>")
@require_auth
def get_complaint_by_id(complaint_id: str):
    """200 ComplaintDetail. Any role — the RESPONSE SHAPE is what differs.

    TODO(phase 3).
      * Citizen — their own complaint only, else 403.
      * Officer — their zone only, reporter identity STRIPPED. Zone is
        evaluated against the officer's account right now, re-read every
        request; never the zone claim in the JWT, and never `assignedOfficerId`.
      * Admin — anything, including the reporter.

    Dispatch to the right audience serializer here. Do not build one serializer
    with an `if role ==` inside it — that is exactly the shape of code where a
    privacy leak hides.
    """
    todo("Complaint detail")


@bp.post("/complaints/<complaint_id>/evidence")
@require_role(CITIZEN)
def submit_additional_evidence(complaint_id: str):
    """200 ComplaintDetail — answering a NEEDS_MORE_EVIDENCE request.

    TODO(phase 3). Appends evidence at the next `sequence` (old rows kept) and
    moves the complaint back to EVIDENCE_UNDER_REVIEW, RESUMING the SLA clock if
    it had already started.
    """
    now = _utcnow()
    citizen = current_user()
    complaint = _owned_complaint(_parse_complaint_id(complaint_id), citizen)
    raise_for(validate_evidence_resubmission(complaint.status))

    photo = request.files.get("photo")
    file_path = _validate_and_store_photo(complaint_id=complaint.id, storage=photo)
    evidence = ComplaintEvidence(
        complaint_id=complaint.id,
        sequence=_next_evidence_sequence(complaint.id),
        file_path=file_path,
        ai_screen_status=AiScreenStatus.PENDING,
        created_at=now,
    )
    db.session.add(evidence)

    paused_seconds, paused_at = resume_sla(
        complaint.sla_paused_seconds,
        complaint.sla_paused_at,
        now,
    )
    previous = complaint.status
    complaint.status = ComplaintStatus.EVIDENCE_UNDER_REVIEW
    complaint.updated_at = now
    complaint.sla_paused_seconds = paused_seconds
    complaint.sla_paused_at = paused_at
    _record_history(
        complaint_id=complaint.id,
        from_status=previous,
        to_status=complaint.status,
        actor_role=StatusActor.CITIZEN,
        changed_by_user_id=citizen.id,
        now=now,
    )
    db.session.commit()
    return jsonify(_serialize_complaint_detail(complaint, now=now)), 201


@bp.post("/complaints/<complaint_id>/upvote")
@require_role(CITIZEN)
def upvote_complaint(complaint_id: str):
    """200 UpvoteResult {upvoteCount, severityScore}.

    TODO(phase 6). 409 ALREADY_UPVOTED on a repeat; no self-upvotes. Credits +5
    to the REPORTER, not the voter, and recomputes severity.
    """
    citizen = current_user()
    complaint = db.session.get(Complaint, _parse_complaint_id(complaint_id))
    if complaint is None:
        raise NotFoundError("No such complaint.")
    if complaint.citizen_id == citizen.id:
        raise ConflictError("SELF_UPVOTE_NOT_ALLOWED", "You cannot upvote your own complaint.")

    existing = db.session.execute(
        select(ComplaintUpvote).where(
            ComplaintUpvote.complaint_id == complaint.id,
            ComplaintUpvote.citizen_id == citizen.id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise ConflictError("ALREADY_UPVOTED", "You have already upvoted this complaint.")

    db.session.add(ComplaintUpvote(complaint_id=complaint.id, citizen_id=citizen.id))
    db.session.add(
        PointsLedger(
            citizen_id=complaint.citizen_id,
            complaint_id=complaint.id,
            points_change=5,
            reason=PointsReason.UPVOTE_RECEIVED,
        )
    )
    db.session.flush()

    cluster_weight = 1
    if complaint.cluster_id is not None:
        cluster = db.session.get(ComplaintCluster, complaint.cluster_id)
        if cluster is not None:
            cluster_weight = cluster.unique_reporter_count
    upvote_count = db.session.execute(
        select(func.count(ComplaintUpvote.id)).where(ComplaintUpvote.complaint_id == complaint.id)
    ).scalar_one()
    complaint.severity_score = severity_score(cluster_weight, int(upvote_count))
    complaint.updated_at = _utcnow()
    db.session.commit()

    return jsonify(
        {
            "complaintId": str(complaint.id),
            "upvoteCount": int(upvote_count),
            "severityLabel": severity_label(complaint.severity_score).value,
        }
    )


@bp.post("/complaints/<complaint_id>/confirm")
@require_role(CITIZEN)
def confirm_resolution(complaint_id: str):
    """200 ComplaintDetail — RESOLVED -> CLOSED.

    TODO(phase 6). The ONLY path that credits confirm rewards. Auto-close and an
    admin-rejected dispute both close a complaint with zero points.
    """
    now = _utcnow()
    citizen = current_user()
    complaint = _owned_complaint(_parse_complaint_id(complaint_id), citizen)
    raise_for(validate_confirm(complaint.status))

    previous = complaint.status
    complaint.status = ComplaintStatus.CLOSED
    complaint.closed_at = now
    complaint.updated_at = now
    _record_history(
        complaint_id=complaint.id,
        from_status=previous,
        to_status=complaint.status,
        actor_role=StatusActor.CITIZEN,
        changed_by_user_id=citizen.id,
        now=now,
    )

    reward_reason = close_reward(
        is_clustered=complaint.cluster_id is not None,
        cluster_reward_already_granted=False,
        citizen_already_rewarded_in_cluster=False,
    )
    if reward_reason is not None:
        if complaint.cluster_id is not None:
            cluster = db.session.get(ComplaintCluster, complaint.cluster_id)
            if cluster is not None:
                if cluster.reward_granted:
                    reward_reason = PointsReason.CLUSTER_MEMBER_CLOSED
                else:
                    cluster.reward_granted = True
                    repeated_cluster_reward = db.session.execute(
                        select(func.count(PointsLedger.id))
                        .join(Complaint, Complaint.id == PointsLedger.complaint_id)
                        .where(
                            PointsLedger.citizen_id == citizen.id,
                            Complaint.cluster_id == complaint.cluster_id,
                            PointsLedger.reason.in_(
                                [
                                    PointsReason.COMPLAINT_CLOSED,
                                    PointsReason.CLUSTER_MEMBER_CLOSED,
                                ]
                            ),
                        )
                    ).scalar_one()
                    if int(repeated_cluster_reward) > 0:
                        reward_reason = None
        if reward_reason is not None:
            db.session.add(
                PointsLedger(
                    citizen_id=citizen.id,
                    complaint_id=complaint.id,
                    points_change=50 if reward_reason is PointsReason.COMPLAINT_CLOSED else 10,
                    reason=reward_reason,
                )
            )

    current_sla = sla_label(
        complaint.sla_target_hours,
        complaint.sla_started_at,
        complaint.sla_paused_seconds,
        complaint.sla_paused_at,
        now,
    )
    if earns_on_time_bonus(current_sla.value if current_sla else None):
        db.session.add(
            PointsLedger(
                citizen_id=citizen.id,
                complaint_id=complaint.id,
                points_change=15,
                reason=PointsReason.ON_TIME_BONUS,
            )
        )

    db.session.commit()
    return jsonify(_serialize_complaint_detail(complaint, now=now))


@bp.post("/complaints/<complaint_id>/dispute")
@require_role(CITIZEN)
def dispute_resolution(complaint_id: str):
    """200 ComplaintDetail — RESOLVED -> REOPENED. multipart: reason + a photo.

    TODO(phase 6). Both are required — the citizen carries the burden of proof.
    An ADMIN then rules on it, never the officer who did the work.
    """
    now = _utcnow()
    citizen = current_user()
    complaint = _owned_complaint(_parse_complaint_id(complaint_id), citizen)
    reason = request.form.get("reason")
    photo = request.files.get("photo")
    raise_for(validate_dispute(complaint.status, reason, photo is not None))

    file_path = _validate_and_store_photo(complaint_id=complaint.id, storage=photo)
    db.session.add(
        ComplaintEvidence(
            complaint_id=complaint.id,
            sequence=_next_evidence_sequence(complaint.id),
            file_path=file_path,
            ai_screen_status=AiScreenStatus.PENDING,
            created_at=now,
        )
    )

    previous = complaint.status
    complaint.status = ComplaintStatus.REOPENED
    complaint.updated_at = now
    _record_history(
        complaint_id=complaint.id,
        from_status=previous,
        to_status=complaint.status,
        actor_role=StatusActor.CITIZEN,
        changed_by_user_id=citizen.id,
        now=now,
        reason=reason,
    )
    db.session.commit()
    return jsonify(_serialize_complaint_detail(complaint, now=now))


# --- Feed ---------------------------------------------------------------------


@bp.get("/feed")
@require_role(CITIZEN)
def get_public_feed():
    """200 FeedListResponse — the anonymized zone feed.

    TODO(phase 3). Citizens only, and only their OWN zone: a citizen asking for
    another zone gets 403, not an empty page.

    The feed reuses the compact Complaint shape, which structurally has no
    reporter field. Location IS exposed (that is the point — the client shows a
    nearby-landmark hint); identity never is.
    """
    todo("Public feed")


# --- Gamification -------------------------------------------------------------


@bp.get("/gamification/points")
@require_role(CITIZEN)
def get_my_points():
    """200 PointsSummary + ledger page.

    TODO(phase 6). Lifetime and monthly totals are SUMs over points_ledger.
    There is no stored total anywhere.
    """
    todo("Points summary")


@bp.get("/gamification/badges")
@require_role(CITIZEN)
def get_my_badges():
    """200 Badge[] — earned and unearned, so the UI can show what is left.

    TODO(phase 6).
    """
    todo("Badges")


@bp.get("/leaderboard")
@require_role(CITIZEN)
def get_leaderboard():
    """200 LeaderboardResponse.

    TODO(phase 6). Sequential ranks, a total order (points, then account age,
    then id), DEACTIVATED citizens excluded, zero-point citizens included.
    Handles are `display_name` or a masked fallback — never `full_name`.
    """
    todo("Leaderboard")
