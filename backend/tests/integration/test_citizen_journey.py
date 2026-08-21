"""The citizen's own path through the system, start to finish.

Registration, filing, tracking, being asked for more evidence, confirming a
fix — every step over HTTP, in order, on state the previous step produced.
"""

from __future__ import annotations

from tests.integration.conftest import PASSWORD, jpeg, not_an_image, png


def test_register_file_track_and_close(platform, citizen, officer):
    """The whole happy path, and the money trail it leaves behind."""
    created = platform.file_complaint(citizen, description="Deep pothole outside the school.")
    complaint_id = created["id"]

    assert created["status"] == "SUBMITTED"
    assert created["category"]["code"] == "POTHOLE"
    # No clock before an officer accepts it. `slaLabel` is optional and
    # non-nullable in the contract, so "no label" is an ABSENT KEY — never a
    # flattering ON_TIME, and never `null`.
    assert "slaLabel" not in created
    assert created["slaTargetHours"] is None
    assert created["severityLabel"] == "LOW"
    assert created["clusterId"] is None
    assert len(created["evidence"]) == 1
    assert created["statusHistory"][0]["toStatus"] == "SUBMITTED"

    # Filing a first complaint pays FIRST_COMPLAINT and unlocks the initiate badge.
    assert citizen.total_csp() == 10
    assert citizen.ledger_reasons() == ["FIRST_COMPLAINT"]
    assert "KARTAVYA_INITIATE" in citizen.badge_codes()

    # It shows up on the citizen's own dashboard.
    dashboard = citizen.get("/complaints/my").get_json()
    assert [item["id"] for item in dashboard["data"]] == [complaint_id]
    assert dashboard["pagination"]["totalItems"] == 1

    # Officer accepts: the SLA clock starts, snapshotting the category target.
    accepted = platform.accept(complaint_id)
    assert accepted["status"] == "UNDER_REVIEW"
    assert accepted["slaTargetHours"] == platform.sla_hours("POTHOLE") == 72
    assert accepted["slaLabel"] == "ON_TIME"

    platform.drive_to(complaint_id, "RESOLVED", note="Filled and levelled.")

    # The citizen is now the one being asked to act.
    awaiting = citizen.get("/complaints/my").get_json()["data"][0]
    assert awaiting["status"] == "RESOLVED"
    assert awaiting["citizenActionNeeded"] == "CONFIRM_FIX"

    closed = citizen.post(f"/complaints/{complaint_id}/confirm").get_json()
    assert closed["status"] == "CLOSED"

    # FIRST_COMPLAINT(10) + COMPLAINT_CLOSED(50) + ON_TIME_BONUS(15).
    assert citizen.total_csp() == 75
    assert sorted(citizen.ledger_reasons()) == [
        "COMPLAINT_CLOSED",
        "FIRST_COMPLAINT",
        "ON_TIME_BONUS",
    ]

    # The audit trail records every hop, in order, with no gaps.
    trail = [entry["toStatus"] for entry in citizen.complaint(complaint_id)["statusHistory"]]
    assert trail == [
        "SUBMITTED",
        "EVIDENCE_UNDER_REVIEW",
        "UNDER_REVIEW",
        "IN_PROGRESS",
        "UNDER_RESOLUTION",
        "RESOLVED",
        "CLOSED",
    ]


def test_confirming_twice_is_a_conflict_and_pays_once(platform, citizen):
    """Double-submit protection, asserted on the ledger rather than the status."""
    created = platform.file_complaint(citizen)
    platform.resolve(created["id"])

    citizen.post(f"/complaints/{created['id']}/confirm")
    before = citizen.total_csp()

    citizen.post(f"/complaints/{created['id']}/confirm", expect=409)

    assert citizen.total_csp() == before
    assert citizen.status_of(created["id"]) == "CLOSED"


def test_only_the_reporter_can_confirm_or_dispute(platform, citizen, officer):
    """A stranger holding the id gets 403 on both citizen-only actions."""
    stranger = platform.register_citizen("Nosy Neighbour", email="nosy@example.com")
    created = platform.file_complaint(citizen)
    platform.resolve(created["id"])

    stranger.post(f"/complaints/{created['id']}/confirm", expect=403)
    stranger.post(
        f"/complaints/{created['id']}/dispute",
        expect=403,
        data={"reason": "Not fixed", "photo": png()},
        content_type="multipart/form-data",
    )
    officer.post(f"/complaints/{created['id']}/confirm", expect=403)

    assert citizen.status_of(created["id"]) == "RESOLVED"


def test_needs_more_evidence_round_trip_pauses_the_sla(platform, citizen, officer):
    """The pause is the part that silently corrupts: paused time must not count.

    Twelve hours pass while the complaint sits in NEEDS_MORE_EVIDENCE, on a
    24-hour SLA. If the pause leaked, that alone would consume 50 % of the
    target and the complaint would come back DELAYED.
    """
    created = platform.file_complaint(citizen, category="WATER_LEAKAGE")
    complaint_id = created["id"]

    platform.accept(complaint_id)
    assert platform.sla_hours("WATER_LEAKAGE") == 24

    recalled = officer.patch(
        f"/officer/complaints/{complaint_id}/status",
        json={"status": "NEEDS_MORE_EVIDENCE", "reason": "The photo is too dark."},
    ).get_json()["complaint"]
    assert recalled["status"] == "NEEDS_MORE_EVIDENCE"
    # The nudge is a citizen-dashboard field; the officer's view has no such key.
    assert "citizenActionNeeded" not in recalled
    assert (
        citizen.get("/complaints/my").get_json()["data"][0]["citizenActionNeeded"]
        == "PROVIDE_MORE_EVIDENCE"
    )

    # Half the SLA target elapses while the clock is parked.
    platform.db_shift(complaint_ids=[complaint_id], hours=12)

    resubmitted = citizen.post(
        f"/complaints/{complaint_id}/evidence",
        expect=201,
        data={"photo": jpeg("clearer.jpg")},
        content_type="multipart/form-data",
    ).get_json()
    assert resubmitted["status"] == "EVIDENCE_UNDER_REVIEW"
    # Both rounds are kept — the evidence table is append-only.
    assert [row["sequence"] for row in resubmitted["evidence"]] == [1, 2]

    resumed = officer.post(
        f"/officer/complaints/{complaint_id}/evidence-review",
        json={"verdict": "VALID"},
    ).get_json()
    assert resumed["status"] == "UNDER_REVIEW"
    assert resumed["slaLabel"] == "ON_TIME"

    from app.models import Complaint

    row = platform.rows().get(Complaint, int(complaint_id))
    assert row.sla_paused_at is None
    assert row.sla_paused_seconds >= 12 * 3600


def test_evidence_resubmission_is_refused_outside_the_needs_more_stage(platform, citizen):
    created = platform.file_complaint(citizen)

    citizen.post(
        f"/complaints/{created['id']}/evidence",
        expect=409,
        data={"photo": png()},
        content_type="multipart/form-data",
    )


def test_rejected_on_the_first_round_penalises_and_terminates(platform, citizen, officer):
    created = platform.file_complaint(citizen, description="My neighbour parks badly.")
    complaint_id = created["id"]

    officer.post(f"/officer/complaints/{complaint_id}/claim")
    rejected = officer.post(
        f"/officer/complaints/{complaint_id}/evidence-review",
        json={"verdict": "REJECTED", "reason": "Not a civic issue."},
    ).get_json()

    assert rejected["status"] == "REJECTED"
    # FIRST_COMPLAINT(+10) then REJECTED_PENALTY(-20).
    assert citizen.total_csp() == -10
    assert "REJECTED_PENALTY" in citizen.ledger_reasons()

    # Terminal: nothing moves it again.
    officer.patch(
        f"/officer/complaints/{complaint_id}/status", expect=409, json={"status": "IN_PROGRESS"}
    )


def test_rejection_is_illegal_once_the_clock_has_ever_started(platform, citizen, officer):
    """`REJECTED` is a first-round-only verdict — after acceptance it is gone.

    Reached the only way it can be: accept, recall for more evidence, let the
    citizen resubmit, then try to reject the second round.
    """
    created = platform.file_complaint(citizen)
    complaint_id = created["id"]

    platform.accept(complaint_id)
    officer.patch(
        f"/officer/complaints/{complaint_id}/status",
        json={"status": "NEEDS_MORE_EVIDENCE", "reason": "Need a wider shot."},
    )
    citizen.post(
        f"/complaints/{complaint_id}/evidence",
        expect=201,
        data={"photo": png("second.png")},
        content_type="multipart/form-data",
    )

    officer.post(
        f"/officer/complaints/{complaint_id}/evidence-review",
        expect=409,
        json={"verdict": "REJECTED", "reason": "trying anyway"},
    )
    # And no penalty was charged on the way to that refusal.
    assert "REJECTED_PENALTY" not in citizen.ledger_reasons()

    resumed = officer.post(
        f"/officer/complaints/{complaint_id}/evidence-review", json={"verdict": "VALID"}
    ).get_json()
    assert resumed["status"] == "UNDER_REVIEW"


def test_upload_rules_are_enforced_at_the_door(platform, citizen):
    """A rejected upload must leave nothing behind — no complaint, no points."""
    citizen.post(
        "/complaints",
        expect=400,
        data={
            "categoryId": platform.category_id(),
            "zoneId": platform.zone_id(),
            "latitude": "12.9",
            "longitude": "77.6",
            "photos": [not_an_image()],
        },
        content_type="multipart/form-data",
    )
    citizen.post(
        "/complaints",
        expect=400,
        data={
            "categoryId": platform.category_id(),
            "zoneId": platform.zone_id(),
            "latitude": "12.9",
            "longitude": "77.6",
            "photos": [png(f"p{index}.png") for index in range(4)],
        },
        content_type="multipart/form-data",
    )

    assert citizen.get("/complaints/my").get_json()["data"] == []
    assert citizen.total_csp() == 0


def test_a_complaint_may_carry_three_photos(platform, citizen):
    created = platform.file_complaint(citizen, photos=3)

    assert [row["sequence"] for row in created["evidence"]] == [1, 2, 3]
    # Every evidence row gets its own signed link, and the compact shape shows
    # the first one.
    assert all(row["photoUrl"] for row in created["evidence"])
    assert created["photoUrl"]


def test_a_deactivated_zone_cannot_receive_new_complaints(platform, citizen, admin):
    """The client's cached zone list goes stale; the server is the backstop."""
    admin.patch(f"/admin/zones/{platform.zone_id('south')}", json={"isActive": False})

    platform.file_complaint(citizen, zone="south", expect=400)


def test_upvotes_raise_severity_and_pay_the_reporter(platform, citizen):
    """Five upvotes cross the LOW -> MEDIUM band, and pay +5 each."""
    created = platform.file_complaint(citizen)
    complaint_id = created["id"]

    for index in range(5):
        voter = platform.register_citizen(f"Voter {index}", email=f"voter{index}@example.com")
        result = voter.post(f"/complaints/{complaint_id}/upvote").get_json()
        assert result["upvoteCount"] == index + 1

    assert result["severityLabel"] == "MEDIUM"
    # FIRST_COMPLAINT(10) + 5 x UPVOTE_RECEIVED(5).
    assert citizen.total_csp() == 35
    assert citizen.ledger_reasons().count("UPVOTE_RECEIVED") == 5


def test_upvote_guards(platform, citizen):
    created = platform.file_complaint(citizen)
    complaint_id = created["id"]
    neighbour = platform.register_citizen("Neighbour", email="neighbour@example.com")
    outsider = platform.register_citizen("Outsider", email="outsider@example.com", zone="south")

    citizen.post(f"/complaints/{complaint_id}/upvote", expect=403)  # own complaint
    outsider.post(f"/complaints/{complaint_id}/upvote", expect=403)  # other zone
    neighbour.post(f"/complaints/{complaint_id}/upvote")
    neighbour.post(f"/complaints/{complaint_id}/upvote", expect=409)  # twice

    assert citizen.complaint(complaint_id)["upvoteCount"] == 1


def test_upvoting_a_closed_complaint_is_refused(platform, citizen):
    neighbour = platform.register_citizen("Neighbour", email="neighbour2@example.com")
    closed = platform.closed_complaint(citizen)

    neighbour.post(f"/complaints/{closed['id']}/upvote", expect=409)


def test_a_citizen_cannot_read_another_citizens_complaint(platform, citizen):
    stranger = platform.register_citizen("Stranger", email="stranger@example.com")
    created = platform.file_complaint(citizen)

    stranger.get(f"/complaints/{created['id']}", expect=403)


def test_the_public_feed_is_anonymous_and_zone_scoped(platform, citizen):
    """The feed is the only place a citizen sees someone else's complaint."""
    neighbour = platform.register_citizen("Neighbour", email="feed-neighbour@example.com")
    southerner = platform.register_citizen(
        "Southerner", email="feed-south@example.com", zone="south"
    )

    mine = platform.file_complaint(citizen)
    theirs = platform.file_complaint(neighbour)
    elsewhere = platform.file_complaint(southerner, zone="south")

    feed = citizen.get("/feed").get_json()
    ids = {item["id"] for item in feed["data"]}
    assert {mine["id"], theirs["id"]} <= ids
    assert elsewhere["id"] not in ids

    for item in feed["data"]:
        assert "reporter" not in item
        assert "citizenId" not in item

    # A citizen may not browse a zone that is not theirs.
    citizen.get(f"/feed?zoneId={platform.zone_id('south')}", expect=403)


def test_the_feed_hides_finished_complaints_until_asked(platform, citizen):
    neighbour = platform.register_citizen("Neighbour", email="feed-closed@example.com")
    closed = platform.closed_complaint(neighbour)
    open_one = platform.file_complaint(neighbour)

    default_ids = {item["id"] for item in citizen.get("/feed").get_json()["data"]}
    assert open_one["id"] in default_ids
    assert closed["id"] not in default_ids

    with_resolved = {
        item["id"] for item in citizen.get("/feed?includeResolved=true").get_json()["data"]
    }
    assert closed["id"] in with_resolved


def test_account_self_service(platform, citizen):
    """Profile edit, password change, and the old password stopping working."""
    profile = citizen.get("/users/me").get_json()
    assert profile["name"] == "Asha Verma"
    assert "passwordHash" not in profile

    updated = citizen.patch("/users/me", json={"displayName": "AshaV"}).get_json()
    assert updated["displayName"] == "AshaV"

    cleared = citizen.patch("/users/me", json={"displayName": None}).get_json()
    assert cleared["displayName"] is None

    citizen.post(
        "/users/me/change-password",
        expect=204,
        json={"currentPassword": PASSWORD, "newPassword": "a-brand-new-password"},
    )

    stale = platform.client.post(
        "/api/v1/auth/login", json={"email": "asha@example.com", "password": PASSWORD}
    )
    assert stale.status_code == 401
    platform.login("asha@example.com", "a-brand-new-password")


def test_deactivation_takes_effect_on_the_next_request(platform, citizen, admin):
    """Authorization is re-read from the row, never trusted from the JWT."""
    citizen.get("/complaints/my")

    platform.deactivate(citizen.id)

    citizen.get("/complaints/my", expect=401)
