"""The officer's working day, and the walls around it.

An officer sees one zone, never a reporter, and can only move a complaint along
edges the state machine allows. All three are asserted here against complaints
that citizens actually filed, rather than rows written straight into the table.
"""

from __future__ import annotations

import pytest

from tests.integration.conftest import png


def test_the_queue_holds_this_officers_zone_and_nothing_else(platform, officer):
    """Two zones, two officers, one wall between them."""
    south_officer = platform.create_officer(
        zone="south", email="officer.south@kartavya.gov", name="South Officer"
    )
    northerner = platform.register_citizen("Northerner", email="north-cit@example.com")
    southerner = platform.register_citizen(
        "Southerner", email="south-cit@example.com", zone="south"
    )

    mine = platform.file_complaint(northerner)
    theirs = platform.file_complaint(southerner, zone="south")

    north_queue = officer.get("/officer/complaints").get_json()
    assert [item["id"] for item in north_queue["data"]] == [mine["id"]]

    south_queue = south_officer.get("/officer/complaints").get_json()
    assert [item["id"] for item in south_queue["data"]] == [theirs["id"]]

    # Not just filtered out of the list — unreachable by direct id, too. The
    # read path answers 403 (the contract's explicit "wrong role or wrong zone"
    # rule); the officer write paths answer 404, which is indistinguishable
    # from an id that does not exist. Both are contract-legal, and both are
    # locked here because the asymmetry is easy to "tidy" into a leak.
    officer.get(f"/complaints/{theirs['id']}", expect=403)
    officer.post(f"/officer/complaints/{theirs['id']}/claim", expect=404)
    officer.post("/officer/complaints/999999/claim", expect=404)
    officer.patch(
        f"/officer/complaints/{theirs['id']}/status", expect=404, json={"status": "IN_PROGRESS"}
    )


def test_no_officer_response_carries_a_reporter(platform, officer, citizen):
    """The cheapest high-value assertion in the project, applied breadth-first."""
    created = platform.file_complaint(citizen)
    complaint_id = created["id"]

    payloads = [
        officer.get("/officer/complaints").get_json(),
        officer.post(f"/officer/complaints/{complaint_id}/claim").get_json(),
        officer.post(
            f"/officer/complaints/{complaint_id}/evidence-review", json={"verdict": "VALID"}
        ).get_json(),
        officer.patch(
            f"/officer/complaints/{complaint_id}/status", json={"status": "IN_PROGRESS"}
        ).get_json(),
        officer.post(
            f"/officer/complaints/{complaint_id}/notes", expect=201, json={"text": "On site."}
        ).get_json(),
        officer.get(f"/complaints/{complaint_id}").get_json(),
        officer.get("/officer/analytics").get_json(),
    ]

    for payload in payloads:
        assert_no_identity(payload)


def assert_no_identity(payload) -> None:
    """Recursively refuse the reporter's identity anywhere in a response."""
    banned = {"reporter", "citizenId", "citizen", "email", "fullName", "full_name"}
    if isinstance(payload, dict):
        leaked = banned & set(payload)
        assert not leaked, f"identity leaked: {sorted(leaked)} in {payload}"
        for value in payload.values():
            assert_no_identity(value)
    elif isinstance(payload, list):
        for item in payload:
            assert_no_identity(item)


def test_the_helper_would_catch_a_nested_leak():
    """A privacy assertion nobody has tested is a privacy assertion nobody has."""
    with pytest.raises(AssertionError):
        assert_no_identity({"data": [{"complaint": {"reporter": {"id": "7"}}}]})


def test_claiming_is_first_come_first_served(platform, officer, citizen):
    """The second claim loses — the guard is a conditional UPDATE, not an `if`."""
    rival = platform.create_officer(
        zone="north", email="officer.north2@kartavya.gov", name="Rival Officer"
    )
    created = platform.file_complaint(citizen)

    claimed = officer.post(f"/officer/complaints/{created['id']}/claim").get_json()
    assert claimed["status"] == "EVIDENCE_UNDER_REVIEW"
    assert claimed["assignedOfficerId"] == officer.id

    rival.post(f"/officer/complaints/{created['id']}/claim", expect=409)
    assert officer.complaint(created["id"])["assignedOfficerId"] == officer.id


def test_the_state_machine_refuses_every_illegal_jump(platform, officer, citizen):
    """Each refusal is checked from the state that actually makes it illegal."""
    created = platform.file_complaint(citizen)
    complaint_id = created["id"]

    # SUBMITTED: the evidence gate has not been passed yet.
    officer.patch(
        f"/officer/complaints/{complaint_id}/status", expect=409, json={"status": "IN_PROGRESS"}
    )

    platform.accept(complaint_id)

    # UNDER_REVIEW: no skipping IN_PROGRESS or UNDER_RESOLUTION.
    officer.patch(
        f"/officer/complaints/{complaint_id}/status", expect=409, json={"status": "RESOLVED"}
    )
    officer.patch(
        f"/officer/complaints/{complaint_id}/status",
        expect=409,
        json={"status": "UNDER_RESOLUTION"},
    )
    # CLOSED is not an officer-requestable target at all.
    officer.patch(
        f"/officer/complaints/{complaint_id}/status", expect=400, json={"status": "CLOSED"}
    )

    assert officer.complaint(complaint_id)["status"] == "UNDER_REVIEW"


def test_reason_is_mandatory_where_the_citizen_is_owed_one(platform, officer, citizen):
    created = platform.file_complaint(citizen)
    complaint_id = created["id"]
    platform.accept(complaint_id)

    officer.patch(
        f"/officer/complaints/{complaint_id}/status", expect=400, json={"status": "UNRESOLVABLE"}
    )
    officer.patch(
        f"/officer/complaints/{complaint_id}/status",
        expect=400,
        json={"status": "NEEDS_MORE_EVIDENCE"},
    )

    done = officer.patch(
        f"/officer/complaints/{complaint_id}/status",
        json={"status": "UNRESOLVABLE", "reason": "Land belongs to the railway."},
    ).get_json()["complaint"]
    assert done["status"] == "UNRESOLVABLE"

    # Terminal — and the citizen is credited nothing for it.
    officer.patch(
        f"/officer/complaints/{complaint_id}/status", expect=409, json={"status": "IN_PROGRESS"}
    )
    assert citizen.ledger_reasons() == ["FIRST_COMPLAINT"]


def test_evidence_review_needs_a_reason_to_send_it_back(platform, officer, citizen):
    created = platform.file_complaint(citizen)
    officer.post(f"/officer/complaints/{created['id']}/claim")

    officer.post(
        f"/officer/complaints/{created['id']}/evidence-review",
        expect=400,
        json={"verdict": "NEEDS_MORE_EVIDENCE"},
    )
    sent_back = officer.post(
        f"/officer/complaints/{created['id']}/evidence-review",
        json={"verdict": "NEEDS_MORE_EVIDENCE", "reason": "Photo is out of focus."},
    ).get_json()

    assert sent_back["status"] == "NEEDS_MORE_EVIDENCE"
    # Pre-acceptance: there is no clock to pause, so none was started either.
    assert sent_back["slaTargetHours"] is None
    assert sent_back["evidence"][0]["verdict"] == "NEEDS_MORE_EVIDENCE"
    assert sent_back["evidence"][0]["reviewedByOfficerId"] == officer.id


def test_progress_notes_belong_to_the_working_stages(platform, officer, citizen):
    created = platform.file_complaint(citizen)
    complaint_id = created["id"]

    officer.post(f"/officer/complaints/{complaint_id}/notes", expect=409, json={"text": "Too soon"})

    platform.accept(complaint_id)
    officer.post(
        f"/officer/complaints/{complaint_id}/notes", expect=409, json={"text": "Still early"}
    )

    officer.patch(f"/officer/complaints/{complaint_id}/status", json={"status": "IN_PROGRESS"})
    note = officer.post(
        f"/officer/complaints/{complaint_id}/notes",
        expect=201,
        json={"text": "Crew scheduled for Tuesday."},
    ).get_json()
    assert note["text"] == "Crew scheduled for Tuesday."
    assert note["officerId"] == officer.id
    assert note["createdAt"].endswith("Z")

    officer.post(f"/officer/complaints/{complaint_id}/notes", expect=400, json={"text": "   "})

    # The citizen sees the note, identified by officer id and never by name.
    seen = citizen.complaint(complaint_id)["progressNotes"]
    assert [row["text"] for row in seen] == ["Crew scheduled for Tuesday."]
    assert seen[0]["officerId"] == officer.id
    assert "officerName" not in seen[0]
    # Same wire format from both doors.
    assert seen[0]["createdAt"] == note["createdAt"]


def test_a_closing_note_lands_in_the_audit_trail_as_a_remark(platform, officer, citizen):
    created = platform.file_complaint(citizen)
    complaint_id = created["id"]
    platform.accept(complaint_id)
    platform.drive_to(complaint_id, "RESOLVED", note="Resurfaced the whole stretch.")

    resolved_entry = [
        entry
        for entry in citizen.complaint(complaint_id)["statusHistory"]
        if entry["toStatus"] == "RESOLVED"
    ][0]
    assert resolved_entry["remark"] == "Resurfaced the whole stretch."
    assert resolved_entry["changedByRole"] == "OFFICER"
    assert resolved_entry["changedByOfficerId"] == officer.id


def test_batch_status_reports_per_item_outcomes(platform, officer, citizen):
    """The one endpoint where partial failure is still a 200."""
    ready = platform.file_complaint(citizen)
    too_early = platform.file_complaint(citizen)
    platform.accept(ready["id"])

    result = officer.post(
        "/officer/complaints/batch-status",
        json={
            "complaintIds": [ready["id"], too_early["id"], "999999"],
            "status": "IN_PROGRESS",
        },
    ).get_json()

    assert result["summary"] == {"requested": 3, "succeeded": 1, "failed": 2}
    outcomes = {row["complaintId"]: row for row in result["results"]}

    assert outcomes[ready["id"]]["success"] is True
    assert outcomes[ready["id"]]["status"] == "IN_PROGRESS"

    assert outcomes[too_early["id"]]["success"] is False
    assert outcomes[too_early["id"]]["previousStatus"] == "SUBMITTED"

    assert outcomes["999999"]["success"] is False
    assert outcomes["999999"]["errorCode"] == "UNKNOWN_COMPLAINT"

    # The failures really did not move.
    assert officer.complaint(too_early["id"])["status"] == "SUBMITTED"


def test_batch_status_cannot_reach_across_the_zone_wall(platform, officer):
    southerner = platform.register_citizen(
        "Southerner", email="batch-south@example.com", zone="south"
    )
    theirs = platform.file_complaint(southerner, zone="south")

    result = officer.post(
        "/officer/complaints/batch-status",
        json={"complaintIds": [theirs["id"]], "status": "IN_PROGRESS"},
    ).get_json()

    assert result["summary"]["succeeded"] == 0
    assert result["results"][0]["success"] is False


def test_batch_status_requires_exactly_one_selector(platform, officer):
    officer.post("/officer/complaints/batch-status", expect=400, json={"status": "IN_PROGRESS"})
    officer.post(
        "/officer/complaints/batch-status",
        expect=400,
        json={"complaintIds": ["1"], "clusterId": "1", "status": "IN_PROGRESS"},
    )


def test_the_queue_filters_and_sorts_across_the_whole_result_set(platform, officer, citizen):
    """`severityLabel` has no column — the filter must be a range on the score."""
    plain = platform.file_complaint(citizen)
    popular = platform.file_complaint(citizen)

    for index in range(5):
        voter = platform.register_citizen(f"Voter {index}", email=f"queue-voter{index}@example.com")
        voter.post(f"/complaints/{popular['id']}/upvote")

    medium = officer.get("/officer/complaints?severityLabel=MEDIUM").get_json()
    assert [item["id"] for item in medium["data"]] == [popular["id"]]

    low = officer.get("/officer/complaints?severityLabel=LOW").get_json()
    assert [item["id"] for item in low["data"]] == [plain["id"]]

    # Default order is most urgent first.
    default_order = officer.get("/officer/complaints").get_json()
    assert default_order["data"][0]["id"] == popular["id"]

    by_status = officer.get("/officer/complaints?status=SUBMITTED&status=RESOLVED").get_json()
    assert len(by_status["data"]) == 2

    by_category = officer.get(
        f"/officer/complaints?categoryId={platform.category_id('OPEN_MANHOLE')}"
    ).get_json()
    assert by_category["data"] == []


def test_the_queue_pages_without_losing_or_repeating_rows(platform, officer, citizen):
    filed = [platform.file_complaint(citizen)["id"] for _ in range(5)]

    first = officer.get("/officer/complaints?page=1&pageSize=2").get_json()
    second = officer.get("/officer/complaints?page=2&pageSize=2").get_json()
    third = officer.get("/officer/complaints?page=3&pageSize=2").get_json()

    assert first["pagination"] == {"page": 1, "pageSize": 2, "totalItems": 5, "totalPages": 3}
    seen = [item["id"] for page in (first, second, third) for item in page["data"]]
    assert sorted(seen) == sorted(filed)
    assert len(set(seen)) == 5


def test_the_sla_filter_reads_the_derived_clock(platform, officer, citizen):
    """Nothing stores `slaLabel`; the filter has to recompute it in SQL."""
    on_time = platform.file_complaint(citizen, category="POTHOLE")
    overdue = platform.file_complaint(citizen, category="POTHOLE")
    platform.accept(on_time["id"])
    platform.accept(overdue["id"])

    # 72-hour target, aged 100 hours.
    platform.db_shift(complaint_ids=[overdue["id"]], hours=100)

    assert [
        item["id"]
        for item in officer.get("/officer/complaints?slaLabel=OVERDUE").get_json()["data"]
    ] == [overdue["id"]]
    assert [
        item["id"]
        for item in officer.get("/officer/complaints?slaLabel=ON_TIME").get_json()["data"]
    ] == [on_time["id"]]
    assert officer.complaint(overdue["id"])["slaLabel"] == "OVERDUE"


def test_an_overdue_close_pays_no_on_time_bonus(platform, officer, citizen):
    """The bonus is judged against this complaint's own SLA snapshot."""
    created = platform.file_complaint(citizen)
    platform.accept(created["id"])
    platform.db_shift(complaint_ids=[created["id"]], hours=100)
    platform.drive_to(created["id"], "RESOLVED")

    citizen.post(f"/complaints/{created['id']}/confirm")

    reasons = citizen.ledger_reasons()
    assert "COMPLAINT_CLOSED" in reasons
    assert "ON_TIME_BONUS" not in reasons
    assert citizen.total_csp() == 60  # FIRST_COMPLAINT(10) + COMPLAINT_CLOSED(50)


def test_zone_analytics_and_summary_answer_for_this_zone_only(platform, officer, citizen):
    platform.create_officer(zone="south", email="officer.south2@kartavya.gov")
    southerner = platform.register_citizen("Southerner", email="an-south@example.com", zone="south")
    platform.file_complaint(southerner, zone="south")

    open_one = platform.file_complaint(citizen)
    platform.accept(open_one["id"])
    platform.db_shift(complaint_ids=[open_one["id"]], hours=100)

    analytics = officer.get("/officer/analytics").get_json()
    assert analytics["zoneId"] == platform.zone_id("north")
    assert analytics["activeComplaints"] == 1
    assert analytics["overdueCount"] == 1

    summary = officer.get(f"/zones/{platform.zone_id('north')}/summary").get_json()
    assert summary == {
        "zoneId": platform.zone_id("north"),
        "totalComplaints": 1,
        "activeComplaints": 1,
        "resolvedComplaints": 0,
        "totalClusters": 0,
        "activeClusters": 0,
    }

    officer.get(f"/zones/{platform.zone_id('south')}/summary", expect=403)


def test_average_resolution_excludes_the_paused_stretch(platform, officer, citizen):
    """`resolved_at - sla_started_at - sla_paused_seconds`, and nothing else.

    Ten hours elapse, four of them parked in NEEDS_MORE_EVIDENCE, so the zone's
    average must land near six — not ten, not two, and not the time since filing.
    """
    created = platform.file_complaint(citizen)
    complaint_id = created["id"]
    accepted = platform.accept(complaint_id)
    first_target = accepted["slaTargetHours"]

    officer.patch(
        f"/officer/complaints/{complaint_id}/status",
        json={"status": "NEEDS_MORE_EVIDENCE", "reason": "Need a wider shot."},
    )
    platform.db_shift(complaint_ids=[complaint_id], hours=4)
    citizen.post(
        f"/complaints/{complaint_id}/evidence",
        expect=201,
        data={"photo": png("clearer.png")},
        content_type="multipart/form-data",
    )

    from app.models import Complaint

    started_before_resume = platform.rows().get(Complaint, int(complaint_id)).sla_started_at

    officer.post(f"/officer/complaints/{complaint_id}/evidence-review", json={"verdict": "VALID"})

    resumed = platform.rows().get(Complaint, int(complaint_id))
    # Resuming is not re-accepting: the original acceptance moment and the
    # target snapshotted with it both survive the round trip.
    assert resumed.sla_started_at == started_before_resume
    assert resumed.sla_target_hours == first_target

    platform.db_shift(complaint_ids=[complaint_id], hours=6)
    platform.drive_to(complaint_id, "RESOLVED")

    average = officer.get("/officer/analytics").get_json()["avgResolutionHoursThisMonth"]
    assert 5.9 <= average <= 6.2


def test_a_recall_cannot_reset_an_overdue_deadline(platform, officer, citizen, admin):
    """Regression: asking for another photo must not buy a fresh SLA window.

    This is the half of the resume rule with an incentive attached — an officer
    sitting on a complaint at 139 % of its target could otherwise zero the clock
    by requesting a better photo. The admin's SLA edit in the middle is the
    second half: the target was frozen at acceptance and a re-acceptance must
    not re-read it.
    """
    created = platform.file_complaint(citizen, category="POTHOLE")
    complaint_id = created["id"]
    platform.accept(complaint_id)

    # 72-hour target, aged 100 hours.
    platform.db_shift(complaint_ids=[complaint_id], hours=100)
    assert officer.complaint(complaint_id)["slaLabel"] == "OVERDUE"

    admin.patch(f"/admin/slas/{platform.category_id('POTHOLE')}", json={"targetHours": 12})

    officer.patch(
        f"/officer/complaints/{complaint_id}/status",
        json={"status": "NEEDS_MORE_EVIDENCE", "reason": "Send a wider shot."},
    )
    citizen.post(
        f"/complaints/{complaint_id}/evidence",
        expect=201,
        data={"photo": png("wider.png")},
        content_type="multipart/form-data",
    )
    resumed = officer.post(
        f"/officer/complaints/{complaint_id}/evidence-review", json={"verdict": "VALID"}
    ).get_json()

    assert resumed["status"] == "UNDER_REVIEW"
    assert resumed["slaLabel"] == "OVERDUE"
    assert resumed["slaTargetHours"] == 72

    # And it is still overdue everywhere the officer's queue looks at it.
    overdue_ids = [
        row["id"] for row in officer.get("/officer/complaints?slaLabel=OVERDUE").get_json()["data"]
    ]
    assert overdue_ids == [complaint_id]
    assert officer.get("/officer/analytics").get_json()["overdueCount"] == 1


def test_public_officer_stats_expose_a_count_and_no_name(platform, officer, citizen):
    created = platform.file_complaint(citizen)
    platform.resolve(created["id"])

    stats = citizen.get(f"/officers/{officer.id}/stats").get_json()

    assert stats == {"officerId": officer.id, "totalResolved": 1}


def test_citizens_are_locked_out_of_every_officer_route(platform, citizen):
    for method, path in [
        ("GET", "/officer/complaints"),
        ("POST", "/officer/complaints/1/claim"),
        ("POST", "/officer/complaints/1/evidence-review"),
        ("PATCH", "/officer/complaints/1/status"),
        ("POST", "/officer/complaints/batch-status"),
        ("POST", "/officer/complaints/1/notes"),
        ("POST", "/officer/clusters/1/notes"),
        ("GET", "/officer/analytics"),
        ("GET", "/clusters"),
        ("GET", "/zones/1/summary"),
    ]:
        citizen.call(method, path, expect=403, json={})


def test_an_officer_reassigned_to_another_zone_loses_the_old_one(platform, officer, citizen, admin):
    """Scoping is re-read from the account on every request, never from the JWT."""
    created = platform.file_complaint(citizen)
    platform.accept(created["id"])
    assert officer.complaint(created["id"])["assignedOfficerId"] == officer.id

    admin.post(
        f"/admin/zones/{platform.zone_id('south')}/assign-officer",
        json={"officerId": int(officer.id)},
    )

    # Same token, immediately scoped elsewhere.
    officer.get(f"/complaints/{created['id']}", expect=403)
    assert officer.get("/officer/complaints").get_json()["data"] == []

    # And the complaint is not left assigned to someone who can no longer open it.
    assert (
        admin.get(f"/admin/complaints?zoneId={platform.zone_id('north')}").get_json()["data"][0][
            "assignedOfficerId"
        ]
        is None
    )
