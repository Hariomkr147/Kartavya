"""Running the system: provisioning, overrides, tuning, analytics, export.

The admin is the only role that sees across zones and the only one that sees
who filed a complaint. Both privileges are asserted here, along with the
guardrails that stop an admin from deleting their way through an audit trail.
"""

from __future__ import annotations

import csv
import io


def test_provisioning_a_zone_and_its_officer(platform, admin):
    zone = admin.post(
        "/admin/zones",
        expect=201,
        json={"code": "WARD-99", "name": "Ward 99 - East", "centerLat": 13.1, "centerLng": 77.7},
    ).get_json()
    assert zone["code"] == "WARD-99"
    assert zone["isActive"] is True

    officer = admin.post(
        "/admin/users",
        expect=201,
        json={
            "role": "OFFICER",
            "name": "East Officer",
            "email": "officer.east@kartavya.gov",
            "password": "password123",
            "zoneId": int(zone["id"]),
        },
    ).get_json()
    assert officer["role"] == "OFFICER"
    assert officer["zoneId"] == zone["id"]
    assert "passwordHash" not in officer

    # The new officer can log in and sees an empty queue in their own zone.
    session = platform.login("officer.east@kartavya.gov")
    assert session.get("/officer/complaints").get_json()["data"] == []


def test_an_officer_always_needs_exactly_one_zone(platform, admin):
    admin.post(
        "/admin/users",
        expect=400,
        json={
            "role": "OFFICER",
            "name": "Homeless Officer",
            "email": "nowhere@kartavya.gov",
            "password": "password123",
        },
    )
    # Admins have no creation endpoint at all — the role is seed-only.
    admin.post(
        "/admin/users",
        expect=400,
        json={
            "role": "ADMIN",
            "name": "Second Admin",
            "email": "admin2@kartavya.gov",
            "password": "password123",
        },
    )


def test_duplicate_emails_are_refused_on_both_doors(platform, admin, citizen):
    admin.post(
        "/admin/users",
        expect=409,
        json={
            "role": "CITIZEN",
            "name": "Impostor",
            "email": "asha@example.com",
            "password": "password123",
            "zoneId": int(platform.zone_id()),
        },
    )
    platform.register_citizen("Impostor", email="asha@example.com", expect=409)


def test_the_user_list_filters_by_role_zone_and_status(platform, admin, citizen, officer):
    platform.register_citizen("Southerner", email="admin-south@example.com", zone="south")

    citizens = admin.get("/admin/users?role=CITIZEN").get_json()
    assert {row["role"] for row in citizens["data"]} == {"CITIZEN"}

    in_north = admin.get(f"/admin/users?zoneId={platform.zone_id('north')}").get_json()
    assert {row["zoneId"] for row in in_north["data"]} == {platform.zone_id("north")}

    platform.deactivate(citizen.id)
    inactive = admin.get("/admin/users?active=false").get_json()
    assert [row["id"] for row in inactive["data"]] == [citizen.id]


def test_an_admin_sees_the_reporter_that_everyone_else_is_denied(platform, admin, citizen, officer):
    created = platform.file_complaint(citizen)

    admin_view = admin.get(f"/complaints/{created['id']}").get_json()
    assert admin_view["reporter"]["id"] == citizen.id
    assert admin_view["reporter"]["name"] == "Asha Verma"

    assert "reporter" not in officer.complaint(created["id"])


def test_the_cross_zone_complaint_list_filters_sorts_and_pages(platform, admin, citizen, officer):
    southerner = platform.register_citizen(
        "Southerner", email="adm-south@example.com", zone="south"
    )
    north = platform.file_complaint(citizen)
    south = platform.file_complaint(southerner, zone="south")
    platform.accept(north["id"])

    everything = admin.get("/admin/complaints").get_json()
    assert {row["id"] for row in everything["data"]} == {north["id"], south["id"]}

    by_zone = admin.get(f"/admin/complaints?zoneId={platform.zone_id('south')}").get_json()
    assert [row["id"] for row in by_zone["data"]] == [south["id"]]

    by_status = admin.get("/admin/complaints?status=UNDER_REVIEW").get_json()
    assert [row["id"] for row in by_status["data"]] == [north["id"]]

    by_category = admin.get(
        f"/admin/complaints?categoryId={platform.category_id('FALLEN_TREE')}"
    ).get_json()
    assert by_category["data"] == []

    paged = admin.get("/admin/complaints?page=1&pageSize=1").get_json()
    assert paged["pagination"] == {"page": 1, "pageSize": 1, "totalItems": 2, "totalPages": 2}

    admin.get("/admin/complaints?sort=nonsense&page=0", expect=400)


def test_an_override_is_recorded_and_backfills_the_missing_clock(platform, admin, citizen):
    """Dropping a complaint past the evidence gate must not lose its SLA."""
    created = platform.file_complaint(citizen)
    complaint_id = created["id"]

    overridden = admin.patch(
        f"/admin/complaints/{complaint_id}",
        json={"status": "IN_PROGRESS", "reason": "Escalated by the ward councillor."},
    ).get_json()

    assert overridden["status"] == "IN_PROGRESS"
    assert overridden["slaTargetHours"] == platform.sla_hours("POTHOLE")
    assert overridden["slaLabel"] == "ON_TIME"

    entry = overridden["statusHistory"][-1]
    assert entry["changedByRole"] == "ADMIN"
    assert entry["reason"] == "Escalated by the ward councillor."

    # The citizen sees the new stage; the officer can pick it up from there.
    assert citizen.status_of(complaint_id) == "IN_PROGRESS"
    platform.drive_to(complaint_id, "RESOLVED")


def test_an_override_may_record_a_reason_and_change_nothing_else(platform, admin, citizen):
    created = platform.file_complaint(citizen)

    annotated = admin.patch(
        f"/admin/complaints/{created['id']}", json={"reason": "Called the reporter to verify."}
    ).get_json()

    assert annotated["status"] == "SUBMITTED"
    assert annotated["statusHistory"][-1]["reason"] == "Called the reporter to verify."

    admin.patch(f"/admin/complaints/{created['id']}", expect=400, json={})


def test_moving_a_complaint_to_another_zone_drops_the_stale_assignment(
    platform, admin, citizen, officer
):
    created = platform.file_complaint(citizen)
    complaint_id = created["id"]
    platform.accept(complaint_id)
    assert officer.complaint(complaint_id)["assignedOfficerId"] == officer.id

    moved = admin.patch(
        f"/admin/complaints/{complaint_id}",
        json={"zoneId": int(platform.zone_id("south")), "reason": "Wrong ward at filing."},
    ).get_json()

    assert moved["zoneId"] == platform.zone_id("south")
    assert moved["assignedOfficerId"] is None
    officer.get(f"/complaints/{complaint_id}", expect=403)


def test_reclassifying_a_clustered_complaint_dissolves_a_two_member_cluster(
    platform, admin, officer
):
    reporter_a = platform.register_citizen("A", email="reclass-a@example.com")
    reporter_b = platform.register_citizen("B", email="reclass-b@example.com")
    spot = platform.fresh_spot()
    first = platform.file_complaint(reporter_a, at=spot)
    second = platform.file_complaint(reporter_b, at=platform.metres_north(spot, 6.0))
    cluster_id = second["clusterId"]
    assert cluster_id is not None

    admin.patch(
        f"/admin/complaints/{second['id']}",
        json={
            "categoryId": int(platform.category_id("GARBAGE_OVERFLOW")),
            "reason": "Miscategorised at filing.",
        },
    )

    # A cluster of one is not a cluster: both complaints come out standalone.
    assert officer.complaint(second["id"])["clusterId"] is None
    assert officer.complaint(first["id"])["clusterId"] is None
    assert officer.complaint(first["id"])["severityScore"] == 0
    officer.get(f"/clusters/{cluster_id}", expect=404)


def test_reassigning_an_officer_clears_only_their_unfinished_work(platform, admin, citizen):
    officer = platform.officer("north")
    finished = platform.file_complaint(citizen)
    in_flight = platform.file_complaint(citizen)
    platform.resolve(finished["id"])
    citizen.post(f"/complaints/{finished['id']}/confirm")
    platform.accept(in_flight["id"])

    admin.patch(f"/admin/users/{officer.id}", json={"zoneId": int(platform.zone_id("south"))})

    listing = {row["id"]: row for row in admin.get("/admin/complaints").get_json()["data"]}
    assert listing[in_flight["id"]]["assignedOfficerId"] is None
    # A closed complaint keeps its history — the officer who did the work stays on it.
    assert listing[finished["id"]]["assignedOfficerId"] == officer.id


def test_deleting_a_user_is_blocked_by_anything_they_touched(platform, admin, citizen, officer):
    created = platform.file_complaint(citizen)
    platform.accept(created["id"])

    blocked_citizen = admin.delete(f"/admin/users/{citizen.id}", expect=409).get_json()
    assert blocked_citizen["error"]["code"]
    blocked_officer = admin.delete(f"/admin/users/{officer.id}", expect=409).get_json()
    assert blocked_officer["error"]["code"]

    # An account that has done nothing can go.
    spare = platform.register_citizen("Spare", email="spare@example.com")
    admin.delete(f"/admin/users/{spare.id}")
    admin.get(f"/admin/users/{spare.id}", expect=404)


def test_zone_lifecycle_and_its_deletion_guards(platform, admin, citizen):
    zone = admin.post(
        "/admin/zones",
        expect=201,
        json={"code": "WARD-77", "name": "Ward 77", "centerLat": 13.2, "centerLng": 77.8},
    ).get_json()

    renamed = admin.patch(
        f"/admin/zones/{zone['id']}", json={"name": "Ward 77 - Renamed"}
    ).get_json()
    assert renamed["name"] == "Ward 77 - Renamed"

    admin.delete(f"/admin/zones/{zone['id']}")  # empty, so it goes

    # A zone with complaints in it does not.
    platform.file_complaint(citizen)
    admin.delete(f"/admin/zones/{platform.zone_id('north')}", expect=409)

    # The catch-all is never deletable, and there is exactly one of it.
    admin.delete(f"/admin/zones/{platform.zone_id('catch_all')}", expect=409)
    admin.post(
        "/admin/zones",
        expect=409,
        json={"code": "WARD-12-N", "name": "Duplicate code", "centerLat": 1.0, "centerLng": 1.0},
    )


def test_an_sla_edit_applies_to_new_complaints_only(platform, admin, citizen, officer):
    """A complaint in flight carries the target it was accepted with, forever."""
    early = platform.file_complaint(citizen)
    platform.accept(early["id"])
    assert officer.complaint(early["id"])["slaTargetHours"] == 72

    updated = admin.patch(
        f"/admin/slas/{platform.category_id('POTHOLE')}", json={"targetHours": 12}
    ).get_json()
    assert updated["slaTargetHours"] == 12

    assert officer.complaint(early["id"])["slaTargetHours"] == 72

    later = platform.file_complaint(citizen)
    platform.accept(later["id"])
    assert officer.complaint(later["id"])["slaTargetHours"] == 12

    admin.patch(
        f"/admin/slas/{platform.category_id('POTHOLE')}", expect=400, json={"targetHours": 0}
    )


def test_settings_round_trip(platform, admin):
    assert admin.get("/admin/settings").get_json() == {"autoCloseTimeoutHours": 168}

    admin.patch("/admin/settings", json={"autoCloseTimeoutHours": 48})
    assert admin.get("/admin/settings").get_json() == {"autoCloseTimeoutHours": 48}

    admin.patch("/admin/settings", expect=400, json={"autoCloseTimeoutHours": 0})
    admin.patch("/admin/settings", expect=400, json={"autoCloseTimeout": 48})


def test_system_analytics_covers_every_zone(platform, admin, citizen, officer):
    created = platform.file_complaint(citizen)
    platform.accept(created["id"])
    platform.db_shift(complaint_ids=[created["id"]], hours=100)

    analytics = admin.get("/admin/analytics").get_json()

    assert analytics["generatedAt"].endswith("Z")
    by_zone = {row["zoneId"]: row for row in analytics["zones"]}
    assert platform.zone_id("north") in by_zone
    assert platform.zone_id("south") in by_zone
    north = by_zone[platform.zone_id("north")]
    assert north["overdue"] == 1
    assert north["isHighestOverdue"] is True
    assert by_zone[platform.zone_id("south")]["isHighestOverdue"] is False


def test_officer_performance_counts_only_this_officers_resolutions(
    platform, admin, citizen, officer
):
    resolved = platform.file_complaint(citizen)
    platform.resolve(resolved["id"])
    sent_back = platform.file_complaint(citizen)
    officer.post(f"/officer/complaints/{sent_back['id']}/claim")
    officer.post(
        f"/officer/complaints/{sent_back['id']}/evidence-review",
        json={"verdict": "NEEDS_MORE_EVIDENCE", "reason": "Too blurry."},
    )

    performance = admin.get(f"/admin/officers/{officer.id}/performance?period=all_time").get_json()

    assert performance["officerId"] == officer.id
    assert performance["totalHandled"] == 2
    assert performance["evidenceBreakdown"] == {"valid": 1, "needsMoreEvidence": 1, "rejected": 0}
    assert performance["acceptRejectRatio"] == 1.0
    assert performance["avgResolutionHours"] is not None

    admin.get(f"/admin/officers/{citizen.id}/performance", expect=404)
    admin.get(f"/admin/officers/{officer.id}/performance?period=yesterday", expect=400)


def test_the_export_is_a_real_csv_without_personal_identity(platform, admin, citizen, officer):
    created = platform.file_complaint(citizen, description='Pothole, "deep", by the gate')
    platform.accept(created["id"])

    response = admin.get("/admin/export/complaints")
    assert response.mimetype == "text/csv"
    assert "attachment" in response.headers["Content-Disposition"]

    body = response.get_data(as_text=True)
    rows = list(csv.DictReader(io.StringIO(body)))
    assert len(rows) == 1
    assert rows[0]["Status"] == "UNDER_REVIEW"
    assert rows[0]["Zone Code"] == "WARD-12-N"

    # Nothing that identifies the reporter, and no free text either — the
    # description is deliberately absent, because a citizen can type their own
    # name into it and the export is the one artefact that leaves the system.
    assert "asha@example.com" not in body
    assert "Asha Verma" not in body
    assert "deep" not in body
    assert "description" not in {key.lower() for key in rows[0]}
    assert "citizen" not in body.lower()

    filtered = admin.get("/admin/export/complaints?status=SUBMITTED").get_data(as_text=True)
    assert len(list(csv.DictReader(io.StringIO(filtered)))) == 0

    admin.get("/admin/export/complaints?zoneId=abc", expect=400)


def test_the_ai_zone_report_degrades_instead_of_failing(platform, admin, citizen):
    """AI never blocks a core flow — the stub provider answers, or the fields do."""
    platform.file_complaint(citizen)

    admin.get(f"/admin/zones/{platform.zone_id('north')}/ai-report", expect=404)

    accepted = admin.post(
        f"/admin/zones/{platform.zone_id('north')}/ai-report", expect=202
    ).get_json()
    assert accepted["zoneId"] == platform.zone_id("north")

    latest = admin.get(f"/admin/zones/{platform.zone_id('north')}/ai-report").get_json()
    assert latest["zoneId"] == platform.zone_id("north")
    assert "aiAvailable" in latest

    admin.post("/admin/zones/999999/ai-report", expect=404)


def test_every_admin_route_is_shut_to_the_other_two_roles(platform, citizen, officer):
    routes = [
        ("GET", "/admin/complaints"),
        ("PATCH", "/admin/complaints/1"),
        ("POST", "/admin/complaints/1/dispute-review"),
        ("GET", "/admin/users"),
        ("POST", "/admin/users"),
        ("GET", "/admin/users/1"),
        ("PATCH", "/admin/users/1"),
        ("DELETE", "/admin/users/1"),
        ("POST", "/admin/zones"),
        ("PATCH", "/admin/zones/1"),
        ("DELETE", "/admin/zones/1"),
        ("POST", "/admin/zones/1/assign-officer"),
        ("PATCH", "/admin/slas/1"),
        ("GET", "/admin/settings"),
        ("PATCH", "/admin/settings"),
        ("GET", "/admin/analytics"),
        ("GET", "/admin/officers/1/performance"),
        ("GET", "/admin/export/complaints"),
        ("POST", "/admin/zones/1/ai-report"),
        ("GET", "/admin/zones/1/ai-report"),
    ]
    for actor in (citizen, officer):
        for method, path in routes:
            actor.call(method, path, expect=403, json={})
