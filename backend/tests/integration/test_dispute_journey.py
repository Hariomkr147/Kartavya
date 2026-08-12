"""Disputes: the one loop where an admin, not an officer, holds the door.

A disputed complaint is the only status an officer may not move, and the only
route back into the working queue runs through the admin's verdict. Both halves
are asserted from the citizen's side of the wall as well as the officer's.
"""

from __future__ import annotations

from tests.integration.conftest import png


def dispute(citizen, complaint_id: str, *, reason: str = "The pothole is back.", expect: int = 200):
    return citizen.post(
        f"/complaints/{complaint_id}/dispute",
        expect=expect,
        data={"reason": reason, "photo": png("dispute.png")},
        content_type="multipart/form-data",
    )


def test_a_dispute_reopens_the_complaint_and_credits_nothing(platform, citizen, officer):
    created = platform.file_complaint(citizen)
    complaint_id = created["id"]
    platform.resolve(complaint_id)
    before = citizen.total_csp()

    reopened = dispute(citizen, complaint_id).get_json()

    assert reopened["status"] == "REOPENED"
    assert citizen.total_csp() == before

    # The photo is appended to the evidence history and never routed through an
    # officer's verdict — the admin judges it directly.
    latest = reopened["evidence"][-1]
    assert latest["sequence"] == 2
    assert latest["verdict"] is None

    entry = [row for row in reopened["statusHistory"] if row["toStatus"] == "REOPENED"][0]
    assert entry["reason"] == "The pothole is back."
    assert entry["changedByRole"] == "CITIZEN"


def test_a_dispute_needs_both_a_reason_and_a_photo(platform, citizen):
    created = platform.file_complaint(citizen)
    platform.resolve(created["id"])

    citizen.post(
        f"/complaints/{created['id']}/dispute",
        expect=400,
        data={"reason": "Still broken."},
        content_type="multipart/form-data",
    )
    citizen.post(
        f"/complaints/{created['id']}/dispute",
        expect=400,
        data={"photo": png()},
        content_type="multipart/form-data",
    )
    assert citizen.status_of(created["id"]) == "RESOLVED"


def test_disputing_is_only_legal_from_resolved_and_only_once(platform, citizen):
    created = platform.file_complaint(citizen)
    complaint_id = created["id"]

    dispute(citizen, complaint_id, expect=409)  # still SUBMITTED

    platform.resolve(complaint_id)
    dispute(citizen, complaint_id)
    dispute(citizen, complaint_id, expect=409)  # already REOPENED

    assert citizen.status_of(complaint_id) == "REOPENED"


def test_confirming_is_no_longer_possible_once_disputed(platform, citizen):
    created = platform.file_complaint(citizen)
    platform.resolve(created["id"])
    dispute(citizen, created["id"])

    citizen.post(f"/complaints/{created['id']}/confirm", expect=409)


def test_no_officer_path_can_move_a_reopened_complaint(platform, citizen, officer):
    """REOPENED is admin-only — the status, batch, and cascade doors are all shut."""
    created = platform.file_complaint(citizen)
    complaint_id = created["id"]
    platform.resolve(complaint_id)
    dispute(citizen, complaint_id)

    for target in ("IN_PROGRESS", "UNDER_RESOLUTION", "RESOLVED"):
        officer.patch(
            f"/officer/complaints/{complaint_id}/status", expect=409, json={"status": target}
        )
    officer.patch(
        f"/officer/complaints/{complaint_id}/status",
        expect=409,
        json={"status": "UNRESOLVABLE", "reason": "give up"},
    )

    batch = officer.post(
        "/officer/complaints/batch-status",
        json={"complaintIds": [complaint_id], "status": "IN_PROGRESS"},
    ).get_json()
    assert batch["summary"]["succeeded"] == 0
    assert batch["results"][0]["previousStatus"] == "REOPENED"

    assert officer.complaint(complaint_id)["status"] == "REOPENED"


def test_upheld_sends_it_back_to_the_officers_queue(platform, citizen, officer, admin):
    created = platform.file_complaint(citizen)
    complaint_id = created["id"]
    platform.resolve(complaint_id)
    dispute(citizen, complaint_id)

    verdict = admin.post(
        f"/admin/complaints/{complaint_id}/dispute-review",
        json={"verdict": "UPHELD", "reason": "The photo shows the same hole."},
    ).get_json()

    assert verdict["status"] == "IN_PROGRESS"
    entry = [row for row in verdict["statusHistory"] if row["toStatus"] == "IN_PROGRESS"][-1]
    assert entry["changedByRole"] == "ADMIN"
    assert entry["reason"] == "The photo shows the same hole."

    # The officer can work it again, and the citizen can confirm the re-fix.
    platform.drive_to(complaint_id, "RESOLVED")
    closed = citizen.post(f"/complaints/{complaint_id}/confirm").get_json()
    assert closed["status"] == "CLOSED"
    assert "COMPLAINT_CLOSED" in citizen.ledger_reasons()


def test_rejected_closes_it_with_no_points_at_all(platform, citizen, admin):
    created = platform.file_complaint(citizen)
    complaint_id = created["id"]
    platform.resolve(complaint_id)
    dispute(citizen, complaint_id)
    before = citizen.total_csp()

    verdict = admin.post(
        f"/admin/complaints/{complaint_id}/dispute-review",
        json={"verdict": "REJECTED", "reason": "The fix is intact in the photo."},
    ).get_json()

    assert verdict["status"] == "CLOSED"
    # Same as an auto-close: nobody did the on-site verification work.
    assert citizen.total_csp() == before
    assert "COMPLAINT_CLOSED" not in citizen.ledger_reasons()
    assert "ON_TIME_BONUS" not in citizen.ledger_reasons()


def test_dispute_review_rejects_bad_input_and_wrong_state(platform, citizen, admin):
    created = platform.file_complaint(citizen)
    complaint_id = created["id"]
    platform.resolve(complaint_id)

    # Not disputed yet.
    admin.post(
        f"/admin/complaints/{complaint_id}/dispute-review",
        expect=409,
        json={"verdict": "UPHELD", "reason": "too early"},
    )

    dispute(citizen, complaint_id)

    admin.post(
        f"/admin/complaints/{complaint_id}/dispute-review",
        expect=400,
        json={"verdict": "UPHELD", "reason": "   "},
    )
    admin.post(
        f"/admin/complaints/{complaint_id}/dispute-review",
        expect=400,
        json={"verdict": "MAYBE", "reason": "unsure"},
    )
    admin.post(
        "/admin/complaints/999999/dispute-review",
        expect=404,
        json={"verdict": "UPHELD", "reason": "nobody home"},
    )

    admin.post(
        f"/admin/complaints/{complaint_id}/dispute-review",
        json={"verdict": "UPHELD", "reason": "Confirmed still broken."},
    )
    # A second verdict on the same complaint has nothing left to rule on.
    admin.post(
        f"/admin/complaints/{complaint_id}/dispute-review",
        expect=409,
        json={"verdict": "REJECTED", "reason": "changed my mind"},
    )


def test_only_an_admin_may_review_a_dispute(platform, citizen, officer):
    created = platform.file_complaint(citizen)
    platform.resolve(created["id"])
    dispute(citizen, created["id"])

    payload = {"verdict": "UPHELD", "reason": "let me out"}
    officer.post(f"/admin/complaints/{created['id']}/dispute-review", expect=403, json=payload)
    citizen.post(f"/admin/complaints/{created['id']}/dispute-review", expect=403, json=payload)


def test_a_disputed_member_stays_in_its_cluster_and_is_skipped_by_the_cascade(platform, officer):
    """Membership is permanent, which is what stops the +50 re-firing."""
    citizen_a = platform.register_citizen("Reporter A", email="dispute-a@example.com")
    citizen_b = platform.register_citizen("Reporter B", email="dispute-b@example.com")
    spot = platform.fresh_spot()

    first = platform.file_complaint(citizen_a, at=spot)
    second = platform.file_complaint(citizen_b, at=platform.metres_north(spot, 8.0))
    cluster_id = second["clusterId"]
    assert cluster_id is not None

    for complaint in (first, second):
        platform.accept(complaint["id"])
        officer.patch(
            f"/officer/complaints/{complaint['id']}/status", json={"status": "IN_PROGRESS"}
        )
    platform.drive_to(first["id"], "RESOLVED")  # cascades `second` to RESOLVED

    # B confirms and takes the one +50; A disputes instead.
    citizen_b.post(f"/complaints/{second['id']}/confirm")
    dispute(citizen_a, first["id"])

    reopened = officer.complaint(first["id"])
    assert reopened["status"] == "REOPENED"
    assert reopened["clusterId"] == cluster_id

    cluster = officer.get(f"/clusters/{cluster_id}").get_json()
    assert cluster["statusSummary"] == {"REOPENED": 1, "CLOSED": 1}

    # An admin upholds it, the officer re-fixes it, and A confirms — the +50 is
    # already spent, so A gets the consolation and nothing more.
    platform.admin.post(
        f"/admin/complaints/{first['id']}/dispute-review",
        json={"verdict": "UPHELD", "reason": "Still broken."},
    )
    platform.drive_to(first["id"], "RESOLVED")
    citizen_a.post(f"/complaints/{first['id']}/confirm")

    assert citizen_a.ledger_reasons().count("COMPLAINT_CLOSED") == 0
    assert citizen_a.ledger_reasons().count("CLUSTER_MEMBER_CLOSED") == 1
    assert citizen_b.ledger_reasons().count("COMPLAINT_CLOSED") == 1
