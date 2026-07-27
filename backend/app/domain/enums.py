"""The 11 database enums, mirroring backend/database/schema.dbml exactly.

Do not add values here that the schema does not have, and do not rename any of
them: these strings are stored in the database as CHECK-constrained text and are
returned verbatim by the API. `schema.dbml` and `openapi.yaml` are the
authority; if this file disagrees with them, this file is wrong.
"""

from __future__ import annotations

from enum import StrEnum


class UserRole(StrEnum):
    """schema.dbml: user_role. Note this is NOT the same set as StatusActor."""

    CITIZEN = "CITIZEN"
    OFFICER = "OFFICER"
    ADMIN = "ADMIN"


class ComplaintStatus(StrEnum):
    """schema.dbml: complaint_status. The transition map lives in lifecycle.py."""

    SUBMITTED = "SUBMITTED"
    EVIDENCE_UNDER_REVIEW = "EVIDENCE_UNDER_REVIEW"
    NEEDS_MORE_EVIDENCE = "NEEDS_MORE_EVIDENCE"
    REJECTED = "REJECTED"
    UNDER_REVIEW = "UNDER_REVIEW"
    IN_PROGRESS = "IN_PROGRESS"
    UNDER_RESOLUTION = "UNDER_RESOLUTION"
    RESOLVED = "RESOLVED"
    CLOSED = "CLOSED"
    REOPENED = "REOPENED"
    UNRESOLVABLE = "UNRESOLVABLE"


class SeverityLabel(StrEnum):
    """Derived from complaints.severity_score on read — never stored."""

    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class SlaLabel(StrEnum):
    """Derived from the four sla_* columns on read — never stored."""

    ON_TIME = "ON_TIME"
    DELAYED = "DELAYED"
    OVERDUE = "OVERDUE"


class EvidenceVerdict(StrEnum):
    """An officer's ruling on a photo (openapi.yaml: EvidenceVerdict)."""

    VALID = "VALID"
    NEEDS_MORE_EVIDENCE = "NEEDS_MORE_EVIDENCE"
    REJECTED = "REJECTED"


class DisputeVerdict(StrEnum):
    """An admin's ruling on a citizen's dispute (openapi.yaml: DisputeVerdict).

    Deliberately a separate enum from EvidenceVerdict — different reviewer,
    different call. Reusing one vocabulary for both would blur that.
    """

    UPHELD = "UPHELD"
    REJECTED = "REJECTED"


class AiScreenStatus(StrEnum):
    """Lets the UI tell "no result yet" apart from "the model was down"."""

    PENDING = "PENDING"
    DONE = "DONE"
    UNAVAILABLE = "UNAVAILABLE"


class StatusActor(StrEnum):
    """schema.dbml: status_actor. Four values — SYSTEM is never an account role."""

    CITIZEN = "CITIZEN"
    OFFICER = "OFFICER"
    ADMIN = "ADMIN"
    SYSTEM = "SYSTEM"


class PointsReason(StrEnum):
    """schema.dbml: points_reason. Amounts live in domain/points.py."""

    COMPLAINT_CLOSED = "COMPLAINT_CLOSED"
    CLUSTER_MEMBER_CLOSED = "CLUSTER_MEMBER_CLOSED"
    FIRST_COMPLAINT = "FIRST_COMPLAINT"
    ON_TIME_BONUS = "ON_TIME_BONUS"
    UPVOTE_RECEIVED = "UPVOTE_RECEIVED"
    REJECTED_PENALTY = "REJECTED_PENALTY"


class BadgeCode(StrEnum):
    """The 6 seeded badges."""

    KARTAVYA_INITIATE = "KARTAVYA_INITIATE"
    STREET_GUARDIAN = "STREET_GUARDIAN"
    ZONE_CHAMPION = "ZONE_CHAMPION"
    CENTURY_REFORMER = "CENTURY_REFORMER"
    CIVIC_HERO = "CIVIC_HERO"
    SWIFT_REPORTER = "SWIFT_REPORTER"


class BadgeCriteriaType(StrEnum):
    """How a badge is earned. Stored per-badge so award logic is data-driven."""

    FIRST_COMPLAINT = "FIRST_COMPLAINT"
    COMPLAINTS_CLOSED = "COMPLAINTS_CLOSED"
    LIFETIME_POINTS = "LIFETIME_POINTS"
    ZONE_RANK_ONE = "ZONE_RANK_ONE"
    CLOSED_WITHIN_DAYS = "CLOSED_WITHIN_DAYS"


class AiReportStatus(StrEnum):
    PENDING = "PENDING"
    READY = "READY"
    FAILED = "FAILED"


# --- API-level enums that are not database columns ---------------------------


class OfficerTargetStatus(StrEnum):
    """The five statuses an officer may request via the status / batch doors.

    Every other status has its own dedicated door (claim, evidence-review,
    confirm, dispute, dispute-review), so asking for one here is a schema-level
    400, not a 409.
    """

    IN_PROGRESS = "IN_PROGRESS"
    UNDER_RESOLUTION = "UNDER_RESOLUTION"
    RESOLVED = "RESOLVED"
    UNRESOLVABLE = "UNRESOLVABLE"
    NEEDS_MORE_EVIDENCE = "NEEDS_MORE_EVIDENCE"


class TransitionFailureCode(StrEnum):
    """Per-item failure codes in the batch-status 200 response."""

    INVALID_TRANSITION = "INVALID_TRANSITION"
    NOT_IN_ZONE = "NOT_IN_ZONE"
    UNKNOWN_COMPLAINT = "UNKNOWN_COMPLAINT"
    REASON_REQUIRED = "REASON_REQUIRED"


class CascadeOutcome(StrEnum):
    """Per-member outcome of a cluster resolution cascade."""

    CASCADED = "CASCADED"
    SKIPPED = "SKIPPED"
