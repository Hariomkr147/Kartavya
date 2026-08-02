"""complaints, complaint_clusters, complaint_evidence — mirrors schema.dbml."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import AiScreenStatus, ComplaintStatus, EvidenceVerdict
from app.models.base import TimestampMixin, db, enum_column, utcnow


class ComplaintCluster(TimestampMixin, db.Model):
    """Nearby same-category, same-zone complaints linked into one shared issue.

    Cluster state is always derived from member statuses, never stored — a
    cluster can hold members at mixed stages, and that is normal.
    """

    __tablename__ = "complaint_clusters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("complaint_categories.id", ondelete="RESTRICT"), nullable=False
    )
    zone_id: Mapped[int] = mapped_column(
        ForeignKey("zones.id", ondelete="RESTRICT"), nullable=False
    )

    centroid_lat: Mapped[float] = mapped_column(Float, nullable=False)
    centroid_lng: Mapped[float] = mapped_column(Float, nullable=False)

    #: Total complaints linked here — may include several from one citizen.
    report_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    #: Distinct citizens. THIS, not report_count, drives severity, so one person
    #: cannot inflate urgency by filing the same issue repeatedly.
    unique_reporter_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    #: True once the one-time +50 has been paid, to whichever member's confirm()
    #: succeeded first. Flip it with an atomic test-and-set
    #: (`UPDATE ... WHERE reward_granted = 0`) inside the same transaction as
    #: the CLOSED write — a read-then-write pays +50 twice under a race.
    reward_granted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    updated_at: Mapped[datetime] = mapped_column(
        nullable=False, default=utcnow, onupdate=utcnow
    )

    members: Mapped[list[Complaint]] = relationship(back_populates="cluster")

    __table_args__ = (Index("ix_complaint_clusters_category_zone", "category_id", "zone_id"),)


class Complaint(TimestampMixin, db.Model):
    __tablename__ = "complaints"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    #: Human-friendly id, e.g. KTV-2026-000123.
    complaint_code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)

    #: The reporter. Hidden from officers and from the public feed — only
    #: app/api/admin/ may ever serialize anything derived from this.
    citizen_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    #: Snapshotted from the citizen-confirmed zone at submit time, never
    #: recomputed. Admin-overridable. Later zone moves cannot alter old rows.
    zone_id: Mapped[int] = mapped_column(
        ForeignKey("zones.id", ondelete="RESTRICT"), nullable=False
    )
    category_id: Mapped[int] = mapped_column(
        ForeignKey("complaint_categories.id", ondelete="RESTRICT"), nullable=False
    )

    #: Never cleared by a dispute — cluster membership is permanent, which is
    #: what stops a disputed-and-refixed member masquerading as a standalone +50.
    cluster_id: Mapped[int | None] = mapped_column(
        ForeignKey("complaint_clusters.id", ondelete="SET NULL")
    )

    #: Null until an officer claims it. Also cleared (app logic, not an FK rule)
    #: on every non-terminal complaint of an officer being reassigned to another
    #: zone — otherwise the complaint stays assigned to someone who can no
    #: longer see it.
    assigned_officer_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    #: Optional — a citizen may pick a category without typing anything.
    description: Mapped[str | None] = mapped_column(Text)

    #: Whether the citizen accepted the client-side keyword matcher's proposal.
    #: Analytics only; it never affects routing or the lifecycle. Record it
    #: exactly as reported — the server does not re-derive it.
    category_suggested_by_matcher: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)

    status: Mapped[ComplaintStatus] = mapped_column(
        enum_column(ComplaintStatus), nullable=False, default=ComplaintStatus.SUBMITTED
    )

    #: The ONE cached derived column, so SQL can sort and filter by it.
    #: (cluster unique_reporter_count - 1) * 3 + this complaint's own upvotes.
    #: Recompute on creation, on cluster join (for every member), and on every
    #: upvote. The severity LABEL is still derived from this on read.
    severity_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # --- SLA inputs. The label is computed from these four, never stored. ---
    #: Snapshot of the category SLA taken at acceptance, so later SLA edits do
    #: not move this complaint. Also backfilled by an admin override.
    sla_target_hours: Mapped[int | None] = mapped_column(Integer)
    #: When it entered UNDER_REVIEW. Null before acceptance.
    sla_started_at: Mapped[datetime | None] = mapped_column()
    #: Time parked in NEEDS_MORE_EVIDENCE, excluded from the SLA. Only accrues
    #: once sla_started_at is set.
    sla_paused_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: Non-null means currently paused; folded into sla_paused_seconds on resume.
    sla_paused_at: Mapped[datetime | None] = mapped_column()

    updated_at: Mapped[datetime] = mapped_column(
        nullable=False, default=utcnow, onupdate=utcnow
    )
    #: Always names the LATEST resolution — overwritten, not appended, when a
    #: disputed complaint is re-resolved. status_history keeps the earlier ones.
    resolved_at: Mapped[datetime | None] = mapped_column()
    closed_at: Mapped[datetime | None] = mapped_column()

    cluster: Mapped[ComplaintCluster | None] = relationship(back_populates="members")
    evidence: Mapped[list[ComplaintEvidence]] = relationship(
        back_populates="complaint",
        cascade="all, delete-orphan",
        order_by="ComplaintEvidence.sequence",
    )
    status_history: Mapped[list["StatusHistory"]] = relationship(
        back_populates="complaint",
        cascade="all, delete-orphan",
        order_by="StatusHistory.created_at",
    )
    notes: Mapped[list["ComplaintNote"]] = relationship(
        back_populates="complaint",
        cascade="all, delete-orphan",
        order_by="ComplaintNote.created_at",
    )

    __table_args__ = (
        Index("ix_complaints_zone_status", "zone_id", "status"),  # the officer queue
        Index("ix_complaints_citizen_id", "citizen_id"),  # GET /complaints/my
        Index("ix_complaints_category_id", "category_id"),
        Index("ix_complaints_cluster_id", "cluster_id"),
        Index("ix_complaints_assigned_officer_id", "assigned_officer_id"),
        Index("ix_complaints_status", "status"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Complaint {self.complaint_code} {self.status}>"


class ComplaintEvidence(TimestampMixin, db.Model):
    """One row per uploaded photo. APPEND-ONLY: never update, never delete.

    `sequence` 1..N are the originals (up to 3); N+1 onward are re-submissions
    and dispute photos. Old rows are always retained.
    """

    __tablename__ = "complaint_evidence"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    complaint_id: Mapped[int] = mapped_column(
        ForeignKey("complaints.id", ondelete="CASCADE"), nullable=False
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)

    #: Path on the local filesystem, under a UUID filename, in a directory
    #: OUTSIDE the web root. INTERNAL — the API never returns this. Clients get
    #: a freshly minted expiring signed link to GET /evidence/{id}/photo, so
    #: re-organising storage never breaks a URL a client holds.
    file_path: Mapped[str] = mapped_column(Text, nullable=False)

    # --- AI photo pre-screening: asynchronous, advisory, never blocking ---
    ai_screen_status: Mapped[AiScreenStatus] = mapped_column(
        enum_column(AiScreenStatus), nullable=False, default=AiScreenStatus.PENDING
    )
    ai_matches_category: Mapped[bool | None] = mapped_column(Boolean)
    ai_confidence: Mapped[float | None] = mapped_column(Float)
    ai_note: Mapped[str | None] = mapped_column(Text)

    # --- Officer verdict ---
    #: Null until reviewed, and PERMANENTLY null for a dispute-evidence row —
    #: that photo is judged by the admin ruling on the dispute, and the ruling
    #: lives on status_history, not here.
    verdict: Mapped[EvidenceVerdict | None] = mapped_column(enum_column(EvidenceVerdict))
    verdict_reason: Mapped[str | None] = mapped_column(Text)
    reviewed_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column()

    complaint: Mapped[Complaint] = relationship(back_populates="evidence")

    __table_args__ = (
        Index("ix_complaint_evidence_complaint_id", "complaint_id"),
        UniqueConstraint("complaint_id", "sequence", name="uq_complaint_evidence_sequence"),
    )
