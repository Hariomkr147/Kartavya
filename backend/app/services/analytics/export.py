"""CSV export service for complaint data."""

from __future__ import annotations

import csv
import io
from collections.abc import Iterator
from datetime import datetime

from sqlalchemy import select

from app.domain import severity, sla
from app.extensions import db
from app.models.accounts import ComplaintCategory, Zone
from app.models.complaints import Complaint
from app.services.queries import apply_filters


def generate_complaints_csv_service(
    *,
    zone_id: int | None = None,
    category_id: int | None = None,
    statuses: list[str] | None = None,
    sla_label: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    now: datetime,
) -> Iterator[str]:
    """Stream CSV lines of complaints matching the filters.

    NOTE (Phase 7 / §7.5 design decision):
    `sla_label` is evaluated as a post-filter on the generator stream using
    `app.domain.sla.label(...)` to guarantee 100% precision with pause clock
    arithmetic without attempting complex SQL-level interval expressions.
    """
    stmt = select(Complaint)
    stmt = apply_filters(
        stmt,
        zone_id=zone_id,
        category_id=category_id,
        statuses=statuses,
        date_from=date_from,
        date_to=date_to,
    )

    zones = {z.id: z.zone_code for z in db.session.scalars(select(Zone)).all()}
    categories = {
        c.id: c.category_code
        for c in db.session.scalars(select(ComplaintCategory)).all()
    }

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([
        "ID",
        "Complaint Code",
        "Category Code",
        "Zone Code",
        "Status",
        "Severity Label",
        "SLA Label",
        "Latitude",
        "Longitude",
        "Assigned Officer ID",
        "Created At",
        "Updated At",
    ])
    yield output.getvalue()
    output.seek(0)
    output.truncate(0)

    for c in db.session.scalars(stmt).yield_per(100):
        sev_lbl = severity.label(c.severity_score).value if c.severity_score is not None else "LOW"
        calculated_sla = sla.label(
            c.sla_target_hours,
            c.sla_started_at,
            c.sla_paused_seconds,
            c.sla_paused_at,
            now,
        )
        sla_lbl_str = calculated_sla.value if calculated_sla else ""

        # Post-filter evaluation for sla_label per §7.5 design decision
        if sla_label is not None and sla_lbl_str != sla_label:
            continue

        writer.writerow([
            str(c.id),
            c.complaint_code or "",
            categories.get(c.category_id, ""),
            zones.get(c.zone_id, ""),
            c.status.value if hasattr(c.status, "value") else str(c.status),
            sev_lbl,
            sla_lbl_str,
            f"{c.latitude:.6f}",
            f"{c.longitude:.6f}",
            str(c.assigned_officer_id) if c.assigned_officer_id else "",
            c.created_at.isoformat() if c.created_at else "",
            c.updated_at.isoformat() if c.updated_at else "",
        ])
        yield output.getvalue()
        output.seek(0)
        output.truncate(0)


def export_complaints_csv_service(
    *,
    zone_id: int | None = None,
    category_id: int | None = None,
    statuses: list[str] | None = None,
    sla_label: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    now: datetime,
) -> str:
    """Generate CSV string of complaints matching the filters."""
    return "".join(
        generate_complaints_csv_service(
            zone_id=zone_id,
            category_id=category_id,
            statuses=statuses,
            sla_label=sla_label,
            date_from=date_from,
            date_to=date_to,
            now=now,
        )
    )
