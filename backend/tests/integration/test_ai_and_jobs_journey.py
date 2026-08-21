"""AI screening, zone reports, and the background sweepers — end to end.

The contract's promise about AI is a negative one: it never blocks a core flow
and never raises. That is only testable by taking the model away mid-journey and
walking the journey anyway, which is what most of this file does.

Screening is called directly rather than through its executor. The production
path is fire-and-forget on a thread pool, so a test that submitted a photo and
immediately asserted on the result would be racing its own background task —
`submit_evidence_screening` is asserted to *queue*, and `screen_evidence` is
asserted to *do the work*.
"""

from __future__ import annotations

from concurrent.futures import wait

import pytest

from tests.integration.conftest import png


@pytest.fixture
def screening_on(platform, monkeypatch):
    """Turn the screening switch back on, and drain what it queues.

    The executor is a module global that outlives any one test, so a task still
    running at teardown would be reaching into a `tmp_path` upload directory and
    a database that are both about to be deleted. Recording the futures keeps
    the real fire-and-forget behaviour and still guarantees quiescence.
    """
    from app.jobs import screening

    submitted = []
    real_submit = screening._executor.submit

    def recording_submit(*args, **kwargs):
        future = real_submit(*args, **kwargs)
        submitted.append(future)
        return future

    monkeypatch.setattr(screening._executor, "submit", recording_submit)
    platform.app.config["AI_SCREENING_ENABLED"] = True
    yield platform
    platform.app.config["AI_SCREENING_ENABLED"] = False
    wait(submitted, timeout=15)


def evidence_row(platform, evidence_id: str):
    from app.models import ComplaintEvidence

    return platform.rows().get(ComplaintEvidence, int(evidence_id))


def test_a_screened_photo_gets_an_advisory_note_the_officer_can_see(
    screening_on, platform, citizen, officer
):
    from app.jobs.screening import screen_evidence

    created = platform.file_complaint(citizen, photos=2)
    evidence_ids = [row["id"] for row in created["evidence"]]

    # Fresh evidence starts PENDING, and PENDING is not "unavailable".
    assert created["evidence"][0]["aiConfidenceNote"]["aiAvailable"] is True
    assert created["evidence"][0]["aiConfidenceNote"]["confidence"] is None

    for evidence_id in evidence_ids:
        screen_evidence(platform.app, int(evidence_id))

    officer.post(f"/officer/complaints/{created['id']}/claim")
    reviewed = officer.complaint(created["id"])
    # Each photo carries its own independent note.
    assert len(reviewed["evidence"]) == 2
    for row in reviewed["evidence"]:
        note = row["aiConfidenceNote"]
        assert note["aiAvailable"] is True
        assert note["matchesCategory"] is True
        assert note["confidence"] == pytest.approx(0.82)
        assert "Pothole" in note["note"]

    # Advisory only: the officer's verdict is unaffected by what the model said.
    rejected = officer.post(
        f"/officer/complaints/{created['id']}/evidence-review",
        json={"verdict": "REJECTED", "reason": "Staged photo despite the AI note."},
    ).get_json()
    assert rejected["status"] == "REJECTED"


def test_filing_still_works_with_the_model_switched_off(screening_on, platform, citizen, officer):
    """The failure mode is a flagged field, never an error."""
    platform.app.config["AI_PROVIDER"] = "null"
    platform.app.extensions.pop("kartavya_evidence_screening_provider", None)

    from app.jobs.screening import screen_evidence

    created = platform.file_complaint(citizen)
    assert created["status"] == "SUBMITTED"

    screen_evidence(platform.app, int(created["evidence"][0]["id"]))

    note = officer.complaint(created["id"])["evidence"][0]["aiConfidenceNote"]
    assert note["aiAvailable"] is False
    assert note["confidence"] is None
    assert note["note"] is None

    # And the complaint still walks the whole lifecycle with no model at all.
    platform.resolve(created["id"])
    assert citizen.post(f"/complaints/{created['id']}/confirm").get_json()["status"] == "CLOSED"


def test_screening_is_queued_by_submission_and_skipped_when_disabled(
    platform, citizen, monkeypatch
):
    """The switch is `AI_SCREENING_ENABLED`, not `TESTING`."""
    from app.jobs import screening

    queued: list[list[int]] = []
    monkeypatch.setattr(
        screening._executor, "submit", lambda fn, app, eid, provider: queued.append(eid)
    )

    platform.app.config["AI_SCREENING_ENABLED"] = False
    screening.submit_evidence_screening(platform.app, [1, 2])
    assert queued == []

    platform.app.config["AI_SCREENING_ENABLED"] = True
    try:
        screening.submit_evidence_screening(platform.app, [1, 2])
        assert queued == [1, 2]
    finally:
        platform.app.config["AI_SCREENING_ENABLED"] = False


def test_the_retry_sweeper_recovers_screening_that_never_landed(
    screening_on, platform, citizen, officer
):
    """An UNAVAILABLE row is otherwise a permanent dead end."""
    platform.app.config["AI_PROVIDER"] = "null"
    platform.app.extensions.pop("kartavya_evidence_screening_provider", None)

    from app.jobs.screening import screen_evidence, sweep_screening_retries

    created = platform.file_complaint(citizen)
    evidence_id = created["evidence"][0]["id"]
    screen_evidence(platform.app, int(evidence_id))
    assert evidence_row(platform, evidence_id).ai_screen_status.value == "UNAVAILABLE"

    # The provider comes back.
    platform.app.config["AI_PROVIDER"] = "stub"
    platform.app.extensions.pop("kartavya_evidence_screening_provider", None)

    assert sweep_screening_retries(platform.app) == 1
    screen_evidence(platform.app, int(evidence_id))

    note = officer.complaint(created["id"])["evidence"][0]["aiConfidenceNote"]
    assert note["aiAvailable"] is True
    assert note["confidence"] == pytest.approx(0.82)


def test_the_sweeper_gives_up_on_rows_past_the_retry_window(screening_on, platform, citizen):
    platform.app.config["AI_PROVIDER"] = "null"
    platform.app.extensions.pop("kartavya_evidence_screening_provider", None)

    from app.jobs.screening import screen_evidence, sweep_screening_retries

    created = platform.file_complaint(citizen)
    evidence_id = created["evidence"][0]["id"]
    screen_evidence(platform.app, int(evidence_id))

    assert evidence_row(platform, evidence_id).ai_screen_status.value == "UNAVAILABLE"

    # Age the row past AI_SCREENING_RETRY_WINDOW_HOURS (6 by default).
    platform.age_evidence(evidence_id, hours=7)

    assert sweep_screening_retries(platform.app) == 0
    assert evidence_row(platform, evidence_id).ai_screen_status.value == "UNAVAILABLE"


def test_screening_never_overwrites_a_finished_verdict(screening_on, platform, citizen):
    from app.jobs.screening import screen_evidence

    created = platform.file_complaint(citizen)
    evidence_id = int(created["evidence"][0]["id"])
    screen_evidence(platform.app, evidence_id)
    first = evidence_row(platform, str(evidence_id)).ai_note

    platform.app.config["AI_PROVIDER"] = "null"
    platform.app.extensions.pop("kartavya_evidence_screening_provider", None)
    screen_evidence(platform.app, evidence_id)  # only PENDING rows are screened

    assert evidence_row(platform, str(evidence_id)).ai_note == first


def test_a_zone_report_reads_as_available_when_the_model_answers(platform, admin, citizen, officer):
    for _ in range(2):
        created = platform.file_complaint(citizen)
        platform.accept(created["id"])

    admin.post(f"/admin/zones/{platform.zone_id('north')}/ai-report", expect=202)
    report = admin.get(f"/admin/zones/{platform.zone_id('north')}/ai-report").get_json()

    assert report["aiAvailable"] is True
    assert report["summary"]
    assert report["generatedAt"].endswith("Z")


def test_a_zone_report_degrades_instead_of_erroring(platform, admin, citizen):
    """`aiAvailable: false` is the contract's answer, not a 500."""
    platform.file_complaint(citizen)
    platform.app.config["AI_PROVIDER"] = "null"

    admin.post(f"/admin/zones/{platform.zone_id('north')}/ai-report", expect=202)
    report = admin.get(f"/admin/zones/{platform.zone_id('north')}/ai-report").get_json()

    assert report["aiAvailable"] is False
    assert report["zoneId"] == platform.zone_id("north")


def test_the_auto_close_sweeper_respects_a_live_settings_change(platform, citizen, admin):
    """The timeout is read from app_settings on every pass, not frozen at boot."""
    from app.jobs.auto_close import sweep_auto_close

    created = platform.file_complaint(citizen)
    platform.resolve(created["id"])
    platform.db_shift(complaint_ids=[created["id"]], hours=50)

    admin.patch("/admin/settings", json={"autoCloseTimeoutHours": 168})
    assert sweep_auto_close(platform.app) == 0

    admin.patch("/admin/settings", json={"autoCloseTimeoutHours": 24})
    assert sweep_auto_close(platform.app) == 1
    assert citizen.status_of(created["id"]) == "CLOSED"


def test_auto_close_never_touches_anything_but_resolved(platform, citizen, officer, admin):
    from app.jobs.auto_close import sweep_auto_close

    admin.patch("/admin/settings", json={"autoCloseTimeoutHours": 1})

    submitted = platform.file_complaint(citizen)
    working = platform.file_complaint(citizen)
    disputed = platform.file_complaint(citizen)
    platform.accept(working["id"])
    officer.patch(f"/officer/complaints/{working['id']}/status", json={"status": "IN_PROGRESS"})
    platform.resolve(disputed["id"])
    citizen.post(
        f"/complaints/{disputed['id']}/dispute",
        data={"reason": "Not fixed at all.", "photo": png("d.png")},
        content_type="multipart/form-data",
    )

    platform.db_shift(hours=48)

    assert sweep_auto_close(platform.app) == 0
    assert citizen.status_of(submitted["id"]) == "SUBMITTED"
    assert citizen.status_of(working["id"]) == "IN_PROGRESS"
    assert citizen.status_of(disputed["id"]) == "REOPENED"
