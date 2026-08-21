"""Duplicate reports of one physical issue, from filing to paid-out rewards.

The cluster rules are the easiest place in the system to lose money quietly:
the +50 is paid once per cluster and at most once per citizen, and both of
those are decided at confirm time by state that three earlier requests built.
Nothing here is set up by hand — every cluster is formed by citizens filing
complaints a few metres apart.
"""

from __future__ import annotations

import pytest


@pytest.fixture
def cluster_of_three(platform):
    """Three citizens report the same pothole, within ~7 m of each other.

    Returns (spot, [(citizen, complaint), ...], cluster_id).
    """
    spot = platform.fresh_spot()
    filed = []
    for index in range(3):
        reporter = platform.register_citizen(
            f"Reporter {index}", email=f"cluster-{index}@example.com"
        )
        complaint = platform.file_complaint(reporter, at=platform.metres_north(spot, index * 7.0))
        filed.append((reporter, complaint))

    cluster_id = platform.admin.get(f"/complaints/{filed[0][1]['id']}").get_json()["clusterId"]
    assert cluster_id is not None
    return spot, filed, cluster_id


def test_a_second_report_nearby_forms_the_cluster(platform, officer):
    first_reporter = platform.register_citizen("First", email="first@example.com")
    second_reporter = platform.register_citizen("Second", email="second@example.com")
    spot = platform.fresh_spot()

    first = platform.file_complaint(first_reporter, at=spot)
    # Standalone until a match arrives — there is nothing to join yet.
    assert first["clusterId"] is None

    second = platform.file_complaint(second_reporter, at=platform.metres_north(spot, 7.0))
    assert second["clusterId"] is not None

    # The first complaint was pulled in by the second one's arrival.
    assert officer.complaint(first["id"])["clusterId"] == second["clusterId"]

    # Two distinct reporters: severity is (2 - 1) * 3 + 0 upvotes.
    assert officer.complaint(first["id"])["severityScore"] == 3


def test_distance_and_category_both_have_to_match(platform, officer):
    """A cluster is same-category AND within radius — neither alone is enough."""
    reporter = platform.register_citizen("Reporter", email="picky@example.com")
    neighbour = platform.register_citizen("Neighbour", email="picky2@example.com")
    spot = platform.fresh_spot()

    anchor = platform.file_complaint(reporter, at=spot, category="POTHOLE")

    far = platform.file_complaint(
        neighbour, at=platform.metres_north(spot, 400.0), category="POTHOLE"
    )
    other_kind = platform.file_complaint(
        neighbour, at=platform.metres_north(spot, 5.0), category="GARBAGE_OVERFLOW"
    )

    assert far["clusterId"] is None
    assert other_kind["clusterId"] is None
    assert officer.complaint(anchor["id"])["clusterId"] is None


def test_one_citizen_filing_repeatedly_cannot_inflate_severity(platform, officer):
    """Severity counts DISTINCT reporters, so duplicates by one person add nothing."""
    reporter = platform.register_citizen("Eager", email="eager@example.com")
    spot = platform.fresh_spot()

    filed = [
        platform.file_complaint(reporter, at=platform.metres_north(spot, index * 5.0))
        for index in range(4)
    ]

    detail = officer.complaint(filed[0]["id"])
    assert detail["clusterId"] is not None
    assert detail["severityScore"] == 0  # (1 unique reporter - 1) * 3

    cluster = officer.get(f"/clusters/{detail['clusterId']}").get_json()
    assert cluster["reportCount"] == 4
    assert cluster["uniqueReporterCount"] == 1
    assert cluster["severityScore"] == 0


def test_the_cluster_view_derives_its_state_from_its_members(platform, officer, cluster_of_three):
    _spot, filed, cluster_id = cluster_of_three

    cluster = officer.get(f"/clusters/{cluster_id}").get_json()
    assert cluster["reportCount"] == 3
    assert cluster["uniqueReporterCount"] == 3
    assert cluster["severityScore"] == 6  # (3 - 1) * 3
    assert cluster["severityLabel"] == "MEDIUM"
    assert cluster["statusSummary"] == {"SUBMITTED": 3}
    assert {member["id"] for member in cluster["complaints"]} == {
        complaint["id"] for _, complaint in filed
    }
    # There is no stored status on a cluster, and no reporter in its members.
    assert "status" not in cluster
    for member in cluster["complaints"]:
        assert "reporter" not in member

    platform.accept(filed[0][1]["id"])
    refreshed = officer.get(f"/clusters/{cluster_id}").get_json()
    assert refreshed["statusSummary"] == {"SUBMITTED": 2, "UNDER_REVIEW": 1}

    listing = officer.get("/clusters").get_json()
    assert [row["id"] for row in listing["data"]] == [cluster_id]


def test_resolving_one_member_cascades_to_the_eligible_rest(platform, officer, cluster_of_three):
    """One fix on the ground resolves every member the gate allows — and only those."""
    _spot, filed, _cluster_id = cluster_of_three
    (_a, first), (_b, second), (_c, third) = filed

    # `first` is driven all the way; `second` is left mid-work (eligible);
    # `third` never leaves the evidence phase (not eligible — the evidence gate
    # is never bypassed by riding a cluster).
    platform.accept(first["id"])
    platform.accept(second["id"])
    officer.patch(f"/officer/complaints/{second['id']}/status", json={"status": "IN_PROGRESS"})

    result = platform.drive_to(first["id"], "RESOLVED")

    assert result["complaint"]["status"] == "RESOLVED"
    outcomes = {row["complaintId"]: row for row in result["cascade"]}
    assert outcomes[second["id"]]["outcome"] == "CASCADED"
    assert outcomes[second["id"]]["previousStatus"] == "IN_PROGRESS"
    assert outcomes[third["id"]]["outcome"] == "SKIPPED"
    assert outcomes[third["id"]]["previousStatus"] == "SUBMITTED"

    assert officer.complaint(second["id"])["status"] == "RESOLVED"
    assert officer.complaint(third["id"])["status"] == "SUBMITTED"

    # A cascaded member's history records SYSTEM as the actor, not the officer.
    cascaded_entry = [
        entry
        for entry in officer.complaint(second["id"])["statusHistory"]
        if entry["toStatus"] == "RESOLVED"
    ][0]
    assert cascaded_entry["changedByRole"] == "SYSTEM"
    # The key is emitted only for OFFICER actors, so a SYSTEM (or ADMIN) hop
    # cannot put a user id in front of the citizen at all.
    assert "changedByOfficerId" not in cascaded_entry


def test_a_standalone_resolution_reports_no_cascade(platform, citizen):
    created = platform.file_complaint(citizen)
    platform.accept(created["id"])

    result = platform.drive_to(created["id"], "RESOLVED")

    assert "cascade" not in result or result["cascade"] == []


def test_the_fifty_is_paid_once_per_cluster_to_whoever_confirms_first(
    platform, officer, cluster_of_three
):
    """Not the first to report — the first to confirm."""
    _spot, filed, _cluster_id = cluster_of_three
    (citizen_a, first), (citizen_b, second), (citizen_c, third) = filed

    for _reporter, complaint in filed:
        platform.accept(complaint["id"])
        officer.patch(
            f"/officer/complaints/{complaint['id']}/status", json={"status": "IN_PROGRESS"}
        )
    officer.patch(f"/officer/complaints/{first['id']}/status", json={"status": "UNDER_RESOLUTION"})
    platform.drive_to(first["id"], "RESOLVED")

    # B confirms first, even though A reported first.
    citizen_b.post(f"/complaints/{second['id']}/confirm")
    assert "COMPLAINT_CLOSED" in citizen_b.ledger_reasons()
    assert "CLUSTER_MEMBER_CLOSED" not in citizen_b.ledger_reasons()

    citizen_a.post(f"/complaints/{first['id']}/confirm")
    reasons_a = citizen_a.ledger_reasons()
    assert "CLUSTER_MEMBER_CLOSED" in reasons_a
    assert "COMPLAINT_CLOSED" not in reasons_a

    citizen_c.post(f"/complaints/{third['id']}/confirm")
    assert "CLUSTER_MEMBER_CLOSED" in citizen_c.ledger_reasons()

    # Exactly one +50 was paid across the whole cluster.
    fifties = sum(
        actor.ledger_reasons().count("COMPLAINT_CLOSED")
        for actor in (citizen_a, citizen_b, citizen_c)
    )
    assert fifties == 1


def test_the_on_time_bonus_is_judged_per_complaint_not_per_cluster(
    platform, officer, cluster_of_three
):
    """A member that only earned the +10 can still separately earn its +15."""
    _spot, filed, _cluster_id = cluster_of_three
    (citizen_a, first), (citizen_b, second), _third = filed

    for _reporter, complaint in filed[:2]:
        platform.accept(complaint["id"])
        officer.patch(
            f"/officer/complaints/{complaint['id']}/status", json={"status": "IN_PROGRESS"}
        )
    officer.patch(f"/officer/complaints/{first['id']}/status", json={"status": "UNDER_RESOLUTION"})
    platform.drive_to(first["id"], "RESOLVED")

    citizen_a.post(f"/complaints/{first['id']}/confirm")
    citizen_b.post(f"/complaints/{second['id']}/confirm")

    reasons_b = citizen_b.ledger_reasons()
    assert "CLUSTER_MEMBER_CLOSED" in reasons_b
    assert "ON_TIME_BONUS" in reasons_b
    # FIRST_COMPLAINT(10) + CLUSTER_MEMBER_CLOSED(10) + ON_TIME_BONUS(15).
    assert citizen_b.total_csp() == 35


def test_one_citizen_with_several_members_is_paid_once(platform, officer):
    """Otherwise filing the same complaint three times farms three rewards."""
    farmer = platform.register_citizen("Farmer", email="farmer@example.com")
    spot = platform.fresh_spot()
    filed = [
        platform.file_complaint(farmer, at=platform.metres_north(spot, index * 6.0))
        for index in range(3)
    ]

    for complaint in filed:
        platform.accept(complaint["id"])
        officer.patch(
            f"/officer/complaints/{complaint['id']}/status", json={"status": "IN_PROGRESS"}
        )
    officer.patch(
        f"/officer/complaints/{filed[0]['id']}/status", json={"status": "UNDER_RESOLUTION"}
    )
    platform.drive_to(filed[0]["id"], "RESOLVED")

    for complaint in filed:
        farmer.post(f"/complaints/{complaint['id']}/confirm")
        assert farmer.status_of(complaint["id"]) == "CLOSED"

    reasons = farmer.ledger_reasons()
    assert reasons.count("COMPLAINT_CLOSED") == 1
    assert reasons.count("CLUSTER_MEMBER_CLOSED") == 0
    # The on-time bonus is still per complaint, so all three earn theirs.
    assert reasons.count("ON_TIME_BONUS") == 3
    # FIRST_COMPLAINT(10) + COMPLAINT_CLOSED(50) + 3 x ON_TIME_BONUS(15).
    assert farmer.total_csp() == 105


def test_a_cluster_note_reaches_every_working_member(platform, officer, cluster_of_three):
    _spot, filed, cluster_id = cluster_of_three
    (_a, first), (_b, second), (_c, third) = filed

    platform.accept(first["id"])
    officer.patch(f"/officer/complaints/{first['id']}/status", json={"status": "IN_PROGRESS"})
    platform.accept(second["id"])
    officer.patch(f"/officer/complaints/{second['id']}/status", json={"status": "IN_PROGRESS"})
    # `third` is still SUBMITTED — outside the note-taking stages.

    notes = officer.post(
        f"/officer/clusters/{cluster_id}/notes",
        expect=201,
        json={"text": "Contractor booked for the whole stretch."},
    ).get_json()

    assert len(notes) == 2
    for complaint in (first, second):
        texts = [row["text"] for row in officer.complaint(complaint["id"])["progressNotes"]]
        assert texts == ["Contractor booked for the whole stretch."]
    assert officer.complaint(third["id"])["progressNotes"] == []


def test_batch_status_can_address_a_whole_cluster(platform, officer, cluster_of_three):
    _spot, filed, cluster_id = cluster_of_three
    for _reporter, complaint in filed[:2]:
        platform.accept(complaint["id"])

    result = officer.post(
        "/officer/complaints/batch-status",
        json={"clusterId": cluster_id, "status": "IN_PROGRESS"},
    ).get_json()

    assert result["summary"]["succeeded"] == 2
    assert result["summary"]["failed"] == 1  # the one still in the evidence phase

    # An unknown cluster is a 404, unlike an unknown complaint id in a list.
    officer.post(
        "/officer/complaints/batch-status",
        expect=404,
        json={"clusterId": "999999", "status": "IN_PROGRESS"},
    )


def test_batch_status_never_cascades(platform, officer, cluster_of_three):
    """A cluster-wide batch is explicit; it must not also fire the cascade."""
    _spot, filed, _cluster_id = cluster_of_three
    (_a, first), (_b, second), _third = filed

    for complaint in (first, second):
        platform.accept(complaint["id"])
        officer.patch(
            f"/officer/complaints/{complaint['id']}/status", json={"status": "IN_PROGRESS"}
        )
    officer.patch(f"/officer/complaints/{first['id']}/status", json={"status": "UNDER_RESOLUTION"})

    result = officer.post(
        "/officer/complaints/batch-status",
        json={"complaintIds": [first["id"]], "status": "RESOLVED"},
    ).get_json()

    assert result["summary"]["succeeded"] == 1
    assert "cascade" not in result
    # `second` was cascade-eligible and stayed exactly where it was.
    assert officer.complaint(second["id"])["status"] == "IN_PROGRESS"


def test_clusters_are_invisible_across_the_zone_wall(platform, officer, cluster_of_three):
    _spot, _filed, cluster_id = cluster_of_three
    south_officer = platform.create_officer(
        zone="south", email="officer.south3@kartavya.gov", name="South Officer"
    )

    assert south_officer.get("/clusters").get_json()["data"] == []
    # 404, not 403: an out-of-zone cluster is indistinguishable from one that
    # was never created, so ids cannot be probed for existence.
    south_officer.get(f"/clusters/{cluster_id}", expect=404)
    south_officer.get("/clusters/999999", expect=404)

    # The admin sees every zone's clusters.
    assert cluster_id in {row["id"] for row in platform.admin.get("/clusters").get_json()["data"]}


def test_a_finished_complaint_leaves_its_cluster(platform, officer, cluster_of_three):
    """A terminal complaint is not part of the work the cluster represents."""
    _spot, filed, cluster_id = cluster_of_three
    (citizen_a, first), (_b, second), (_c, third) = filed

    before = officer.get(f"/clusters/{cluster_id}").get_json()
    assert before["reportCount"] == 3
    assert before["uniqueReporterCount"] == 3
    assert before["severityScore"] == 6

    # Take one member all the way to CLOSED.
    for complaint in (first, second, third):
        platform.accept(complaint["id"])
        officer.patch(
            f"/officer/complaints/{complaint['id']}/status", json={"status": "IN_PROGRESS"}
        )
    officer.patch(f"/officer/complaints/{first['id']}/status", json={"status": "UNDER_RESOLUTION"})
    platform.drive_to(first["id"], "RESOLVED")
    citizen_a.post(f"/complaints/{first['id']}/confirm")

    # It has left: no cluster on the complaint, and the cluster's own counts
    # and severity now describe only the reports still in play.
    assert officer.complaint(first["id"])["clusterId"] is None
    after = officer.get(f"/clusters/{cluster_id}").get_json()
    assert after["reportCount"] == 2
    assert after["uniqueReporterCount"] == 2
    assert after["severityScore"] == 3
    assert first["id"] not in {member["id"] for member in after["complaints"]}
    assert after["statusSummary"] == {"RESOLVED": 2}


def test_a_rejected_complaint_leaves_too(platform, officer):
    """Not only CLOSED — every terminal status exits."""
    reporter_a = platform.register_citizen("Exit A", email="exit-a@example.com")
    reporter_b = platform.register_citizen("Exit B", email="exit-b@example.com")
    spot = platform.fresh_spot()
    first = platform.file_complaint(reporter_a, at=spot)
    second = platform.file_complaint(reporter_b, at=platform.metres_north(spot, 5.0))
    cluster_id = second["clusterId"]

    officer.post(f"/officer/complaints/{second['id']}/claim")
    officer.post(
        f"/officer/complaints/{second['id']}/evidence-review",
        json={"verdict": "REJECTED", "reason": "Staged photo."},
    )

    assert officer.complaint(second["id"])["clusterId"] is None
    assert officer.complaint(first["id"])["clusterId"] == cluster_id

    # UNRESOLVABLE as well.
    platform.accept(first["id"])
    officer.patch(
        f"/officer/complaints/{first['id']}/status",
        json={"status": "UNRESOLVABLE", "reason": "Railway land."},
    )
    assert officer.complaint(first["id"])["clusterId"] is None


def test_a_cluster_whose_members_all_finish_disappears(platform, officer, cluster_of_three):
    """The dead clusters that piled up during alpha testing."""
    _spot, filed, cluster_id = cluster_of_three

    for reporter, complaint in filed:
        platform.accept(complaint["id"])
        officer.patch(
            f"/officer/complaints/{complaint['id']}/status", json={"status": "IN_PROGRESS"}
        )
        officer.patch(
            f"/officer/complaints/{complaint['id']}/status",
            json={"status": "UNDER_RESOLUTION"},
        )
        platform.drive_to(complaint["id"], "RESOLVED")
        reporter.post(f"/complaints/{complaint['id']}/confirm")

    assert officer.get("/clusters").get_json()["data"] == []
    officer.get(f"/clusters/{cluster_id}", expect=404)
    assert platform.admin.get("/clusters").get_json()["data"] == []


def test_leaving_the_cluster_cannot_be_used_to_collect_twice(platform, officer):
    """The regression the exit could easily have introduced.

    Once a closed complaint leaves, "has this citizen already been paid in this
    cluster?" can no longer be answered from current membership alone. If it
    were, this citizen would be paid a second time for their second duplicate.
    """
    farmer = platform.register_citizen("Farmer", email="exit-farmer@example.com")
    spot = platform.fresh_spot()
    filed = [
        platform.file_complaint(farmer, at=platform.metres_north(spot, index * 6.0))
        for index in range(3)
    ]

    for complaint in filed:
        platform.accept(complaint["id"])
        officer.patch(
            f"/officer/complaints/{complaint['id']}/status", json={"status": "IN_PROGRESS"}
        )
    officer.patch(
        f"/officer/complaints/{filed[0]['id']}/status", json={"status": "UNDER_RESOLUTION"}
    )
    platform.drive_to(filed[0]["id"], "RESOLVED")

    for complaint in filed:
        farmer.post(f"/complaints/{complaint['id']}/confirm")

    reasons = farmer.ledger_reasons()
    assert reasons.count("COMPLAINT_CLOSED") == 1
    assert reasons.count("CLUSTER_MEMBER_CLOSED") == 0


def test_two_citizens_still_split_the_reward_correctly_across_exits(platform, officer):
    """The +50 stays once-per-cluster even though the winner has since left."""
    citizen_a = platform.register_citizen("Split A", email="split-a@example.com")
    citizen_b = platform.register_citizen("Split B", email="split-b@example.com")
    spot = platform.fresh_spot()
    first = platform.file_complaint(citizen_a, at=spot)
    second = platform.file_complaint(citizen_b, at=platform.metres_north(spot, 6.0))

    for complaint in (first, second):
        platform.accept(complaint["id"])
        officer.patch(
            f"/officer/complaints/{complaint['id']}/status", json={"status": "IN_PROGRESS"}
        )
    officer.patch(f"/officer/complaints/{first['id']}/status", json={"status": "UNDER_RESOLUTION"})
    platform.drive_to(first["id"], "RESOLVED")

    citizen_a.post(f"/complaints/{first['id']}/confirm")  # takes the +50, then exits
    citizen_b.post(f"/complaints/{second['id']}/confirm")

    assert citizen_a.ledger_reasons().count("COMPLAINT_CLOSED") == 1
    assert citizen_b.ledger_reasons().count("COMPLAINT_CLOSED") == 0
    assert citizen_b.ledger_reasons().count("CLUSTER_MEMBER_CLOSED") == 1


def test_verify_clusters_reports_and_repairs(platform, officer, cluster_of_three):
    """The verification step, run against a deliberately corrupted cluster."""
    from app.models import Complaint
    from app.services.complaints.cluster_health import verify_clusters

    _spot, filed, cluster_id = cluster_of_three
    (citizen_a, first), _b, _c = filed

    platform.accept(first["id"])
    officer.patch(f"/officer/complaints/{first['id']}/status", json={"status": "IN_PROGRESS"})
    officer.patch(f"/officer/complaints/{first['id']}/status", json={"status": "UNDER_RESOLUTION"})
    platform.drive_to(first["id"], "RESOLVED")
    citizen_a.post(f"/complaints/{first['id']}/confirm")

    # A clean system has nothing to say about itself.
    assert verify_clusters().ok

    # Simulate the pre-fix state: put the finished complaint back in, and skew
    # the stored counts the way a missed recompute would.
    session = platform.rows()
    row = session.get(Complaint, int(first["id"]))
    row.cluster_id = int(cluster_id)
    session.commit()

    report = verify_clusters()
    assert not report.ok
    kinds = {finding.kind for finding in report.findings}
    assert "terminal_member" in kinds
    assert "stale_aggregates" in kinds

    repaired = verify_clusters(repair=True)
    assert repaired.repaired
    assert verify_clusters().ok

    # And the repair produced the same state the live path would have.
    assert officer.complaint(first["id"])["clusterId"] is None
    assert officer.get(f"/clusters/{cluster_id}").get_json()["reportCount"] == 2
