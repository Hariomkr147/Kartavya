"""Mandatory seed data. THE APPLICATION DOES NOT WORK WITHOUT THIS.

    flask --app app seed            # idempotent; safe to re-run
    flask --app app seed --demo     # also adds three example zones for dev

What the schema requires before first use:
  * the 12 complaint categories, each with its default sla_hours
  * the 6 badges, with criteria_type / criteria_value / criteria_count
  * EXACTLY ONE zone with is_catch_all = true (never deletable)
  * the single app_settings row (id = 1)
  * at least one ADMIN user — ⚠ admins are SEEDED ONLY. There is deliberately
    no API that creates one.

Category codes and badge criteria are copied from the frontend mock's seed
(`frontend/src/mocks/db/seed.ts`), which the finished UI already runs against —
so the two datasets agree and screenshots of the mock match the real thing.
"""

from __future__ import annotations

import os

import click
from flask.cli import with_appcontext

from app.domain.enums import BadgeCode, BadgeCriteriaType, UserRole
from app.extensions import db
from app.models import (
    SETTINGS_ROW_ID,
    AppSettings,
    Badge,
    ComplaintCategory,
    User,
    Zone,
)

# --- The fixed reference data -------------------------------------------------

#: (code, name, description, sla_hours). Seeded once and never edited in place —
#: `category_code` is the key the client-side keyword matcher is written against.
CATEGORIES: list[tuple[str, str, str, int]] = [
    (
        "POTHOLE",
        "Pothole",
        "A hole in the road surface that can damage vehicles or injure people.",
        72,
    ),
    (
        "OPEN_MANHOLE",
        "Open Manhole",
        "An uncovered or missing manhole cover — a serious fall hazard.",
        6,
    ),
    (
        "BROKEN_STREETLIGHT",
        "Broken Street Light",
        "A street light that is damaged, flickering, or not working.",
        24,
    ),
    (
        "GARBAGE_OVERFLOW",
        "Garbage Overflow",
        "An overflowing public garbage bin or an uncollected waste pile.",
        48,
    ),
    (
        "WATER_LEAKAGE",
        "Water Leakage",
        "A burst or leaking pipe wasting water on a public road.",
        24,
    ),
    (
        "DRAINAGE_OVERFLOW",
        "Drainage Overflow",
        "A blocked or overflowing storm drain causing waterlogging.",
        12,
    ),
    ("SEWAGE_BLOCKAGE", "Sewage Blockage", "A blocked or overflowing sewage line.", 24),
    (
        "DAMAGED_FOOTPATH",
        "Damaged Footpath",
        "Broken, uneven, or missing footpath tiles or slabs.",
        96,
    ),
    (
        "FALLEN_TREE",
        "Fallen Tree or Branch",
        "A fallen tree or branch obstructing a road or path.",
        12,
    ),
    (
        "STRAY_ANIMAL",
        "Stray Animal Nuisance",
        "Aggressive or unmanaged stray animals posing a public risk.",
        48,
    ),
    (
        "ILLEGAL_DUMPING",
        "Illegal Dumping",
        "Construction debris or waste dumped illegally in a public space.",
        48,
    ),
    (
        "TRAFFIC_SIGNAL_FAULT",
        "Traffic Signal Malfunction",
        "A traffic signal that is stuck, dark, or malfunctioning.",
        6,
    ),
]

#: (code, name, description, criteria_type, criteria_value, criteria_count).
BADGES: list[tuple[BadgeCode, str, str, BadgeCriteriaType, int | None, int | None]] = [
    (
        BadgeCode.KARTAVYA_INITIATE,
        "Kartavya Initiate",
        "Filed your first complaint.",
        BadgeCriteriaType.FIRST_COMPLAINT,
        None,
        None,
    ),
    (
        BadgeCode.STREET_GUARDIAN,
        "Street Guardian",
        "Had 5 complaints resolved and confirmed fixed.",
        BadgeCriteriaType.COMPLAINTS_CLOSED,
        5,
        None,
    ),
    (
        BadgeCode.ZONE_CHAMPION,
        "Zone Champion",
        "Ranked #1 on your zone's leaderboard.",
        BadgeCriteriaType.ZONE_RANK_ONE,
        None,
        None,
    ),
    (
        BadgeCode.CENTURY_REFORMER,
        "Century Reformer",
        "Earned 100 lifetime Community Service Points.",
        BadgeCriteriaType.LIFETIME_POINTS,
        100,
        None,
    ),
    (
        BadgeCode.CIVIC_HERO,
        "Civic Hero",
        "Earned 500 lifetime Community Service Points.",
        BadgeCriteriaType.LIFETIME_POINTS,
        500,
        None,
    ),
    (
        BadgeCode.SWIFT_REPORTER,
        "Swift Reporter",
        "Had 3 complaints closed within 7 days of each other.",
        BadgeCriteriaType.CLOSED_WITHIN_DAYS,
        7,
        3,
    ),
]

#: Example zones for local development only. Bengaluru coordinates, matching the
#: frontend mock so the two datasets line up.
DEMO_ZONES: list[tuple[str, str, float, float]] = [
    ("WARD-12-N", "Ward 12 – North", 12.9716, 77.5946),
    ("WARD-07-S", "Ward 7 – South", 12.9510, 77.5712),
    ("WARD-14-C", "Ward 14 – Central", 12.9350, 77.6100),
]


# --- The seed itself ----------------------------------------------------------


def seed_all(*, include_demo_zones: bool = False) -> dict[str, int]:
    """Insert anything missing. Idempotent — re-running changes nothing.

    Idempotence matters more than it looks: this runs on every fresh dev
    database, in CI, and possibly twice on a deploy. It must never duplicate a
    category or reset an admin's password.

    Returns a count of rows created, per table.
    """
    created = {"zones": 0, "categories": 0, "badges": 0, "settings": 0, "admins": 0}

    # 1. The catch-all zone. Exactly one row may ever have is_catch_all = true;
    #    the partial unique index on `zones` is the backstop.
    catch_all = db.session.query(Zone).filter_by(is_catch_all=True).one_or_none()
    if catch_all is None:
        db.session.add(
            Zone(
                zone_code="UNASSIGNED",
                zone_name="Unassigned",
                center_lat=0.0,
                center_lng=0.0,
                is_catch_all=True,
                is_active=True,
            )
        )
        created["zones"] += 1

    if include_demo_zones:
        for code, name, lat, lng in DEMO_ZONES:
            if db.session.query(Zone).filter_by(zone_code=code).one_or_none() is None:
                db.session.add(
                    Zone(
                        zone_code=code,
                        zone_name=name,
                        center_lat=lat,
                        center_lng=lng,
                        is_catch_all=False,
                        is_active=True,
                    )
                )
                created["zones"] += 1

    # 2. The 12 categories.
    for code, name, description, sla_hours in CATEGORIES:
        existing = db.session.query(ComplaintCategory).filter_by(category_code=code).one_or_none()
        if existing is None:
            db.session.add(
                ComplaintCategory(
                    category_code=code,
                    category_name=name,
                    description=description,
                    sla_hours=sla_hours,
                )
            )
            created["categories"] += 1
        # Note: an EXISTING category's sla_hours is left alone. Admins edit that
        # value through the API, and a re-seed must not stamp their tuning back
        # to the defaults.

    # 3. The 6 badges.
    for code, name, description, criteria_type, criteria_value, criteria_count in BADGES:
        if db.session.query(Badge).filter_by(badge_code=code).one_or_none() is None:
            db.session.add(
                Badge(
                    badge_code=code,
                    badge_name=name,
                    description=description,
                    criteria_type=criteria_type,
                    criteria_value=criteria_value,
                    criteria_count=criteria_count,
                )
            )
            created["badges"] += 1

    # 4. The single settings row.
    if db.session.get(AppSettings, SETTINGS_ROW_ID) is None:
        db.session.add(AppSettings(id=SETTINGS_ROW_ID, auto_close_timeout_hours=168))
        created["settings"] += 1

    # 5. At least one admin. Admins have no creation endpoint, by design.
    admin_email = os.environ.get("KARTAVYA_ADMIN_EMAIL", "admin@kartavya.gov")
    if db.session.query(User).filter_by(role=UserRole.ADMIN).count() == 0:
        from app.services.accounts.auth import hash_password

        password = os.environ.get("KARTAVYA_ADMIN_PASSWORD")
        if not password:
            password = "changeme123"
            click.echo(
                click.style(
                    "  ! Seeded the admin with the default password. Set "
                    "KARTAVYA_ADMIN_PASSWORD before doing this anywhere real.",
                    fg="yellow",
                )
            )
        db.session.add(
            User(
                full_name="System Administrator",
                display_name=None,
                email=admin_email,
                password_hash=hash_password(password),
                role=UserRole.ADMIN,
                zone_id=None,  # admins belong to no zone
                is_active=True,
            )
        )
        created["admins"] += 1

    db.session.commit()
    return created


@click.command("seed")
@click.option(
    "--demo",
    "include_demo_zones",
    is_flag=True,
    help="Also create three example zones, for local development.",
)
@with_appcontext
def seed_command(include_demo_zones: bool) -> None:
    """Insert the mandatory seed data. Safe to run repeatedly."""
    created = seed_all(include_demo_zones=include_demo_zones)
    total = sum(created.values())
    if total == 0:
        click.echo("Nothing to do — the database is already seeded.")
        return
    for table, count in created.items():
        if count:
            click.echo(f"  + {count} {table}")
    click.echo(click.style(f"Seeded {total} rows.", fg="green"))


@click.command("verify-clusters")
@click.option(
    "--repair",
    is_flag=True,
    help="Fix what is fixable (terminal members still in a cluster, stale aggregates).",
)
@with_appcontext
def verify_clusters_command(repair: bool) -> None:
    """Check every cluster against its members.

    Read-only without `--repair`, so it is safe to run against production to
    see what is there before deciding to change anything.
    """
    from app.services.complaints.cluster_health import cluster_counts, verify_clusters

    report = verify_clusters(repair=repair)
    counts = cluster_counts()

    click.echo(
        f"{counts['total']} cluster(s): {counts['live']} live, "
        f"{counts['dissolved']} dissolved (hidden from the cluster endpoints)."
    )

    if report.ok:
        click.echo(click.style("No problems found.", fg="green"))
        return

    by_kind: dict[str, int] = {}
    for finding in report.findings:
        by_kind[finding.kind] = by_kind.get(finding.kind, 0) + 1
    for kind, count in sorted(by_kind.items()):
        click.echo(f"  {kind}: {count}")

    for finding in report.findings[:20]:
        where = f"cluster {finding.cluster_id}" if finding.cluster_id else "unassigned"
        click.echo(f"    - [{finding.kind}] {where}: {finding.detail}")
    if len(report.findings) > 20:
        click.echo(f"    … and {len(report.findings) - 20} more")

    if report.repaired:
        for line in report.repaired[:20]:
            click.echo(click.style(f"  + {line}", fg="green"))
        click.echo(click.style(f"Repaired {len(report.repaired)} row(s).", fg="green"))
    elif any(f.kind in {"terminal_member", "stale_aggregates"} for f in report.findings):
        click.echo(click.style("Re-run with --repair to fix the repairable findings.", fg="yellow"))
