"""Officer endpoints, exercised against a real database.

These were previously written against a mocked `db.session`, which meant the
assertions described the mock rather than the endpoint — a queue that filtered
the wrong rows or an action that returned an empty `evidence` array both passed.
Everything here goes through the real query builders and the real serializers.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.domain.enums import ComplaintStatus, UserRole
from app.models import (
    Complaint,
    ComplaintCategory,
    ComplaintEvidence,
    User,
    Zone,
)
from app.services.accounts.auth import hash_password

API = "/api/v1"


def make_user(session, *, role, email, zone_id=None, active=True):
    user = User(
        full_name=f"{role.value.title()} User",
        email=email,
        password_hash=hash_password("password123"),
        role=role,
        zone_id=zone_id,
        is_active=active,
    )
    session.add(user)
    session.commit()
    return user


def make_zone(session, code="ZN-1", name="Zone One"):
    zone = Zone(
        zone_code=code,
        zone_name=name,
        center_lat=12.9,
        center_lng=77.6,
        is_catch_all=False,
        is_active=True,
    )
    session.add(zone)
    session.commit()
    return zone


def category(session):
    return session.query(ComplaintCategory).order_by(ComplaintCategory.id).first()


def make_complaint(
    session,
    *,
    citizen,
    zone,
    category_row,
    code="CMP-1",
    status=ComplaintStatus.SUBMITTED,
    severity_score=0,
    officer=None,
    sla_target_hours=None,
    sla_started_at=None,
    with_evidence=True,
    now=None,
):
    created = now or datetime(2026, 7, 1, 12)
    complaint = Complaint(
        complaint_code=code,
        citizen_id=citizen.id,
        zone_id=zone.id,
        category_id=category_row.id,
        assigned_officer_id=officer.id if officer else None,
        latitude=12.9,
        longitude=77.6,
        status=status,
        severity_score=severity_score,
        sla_target_hours=sla_target_hours,
        sla_started_at=sla_started_at,
        sla_paused_seconds=0,
        created_at=created,
        updated_at=created,
    )
    session.add(complaint)
    session.commit()
    if with_evidence:
        session.add(
            ComplaintEvidence(
                complaint_id=complaint.id,
                sequence=1,
                file_path=f"{complaint.id}/photo.jpg",
                created_at=created,
            )
        )
        session.commit()
    return complaint


@pytest.fixture
def officer_setup(seeded_app, session, auth_header):
    zone = make_zone(session)
    officer = make_user(session, role=UserRole.OFFICER, email="ofc@example.com", zone_id=zone.id)
    citizen = make_user(
        session, role=UserRole.CITIZEN, email="cit@example.com", zone_id=zone.id
    )
    return officer, citizen, zone, auth_header(officer)


# --- Authorization and zone scoping -------------------------------------------


def test_officer_routes_require_officer(seeded_app, client, session, auth_header):
    citizen = make_user(session, role=UserRole.CITIZEN, email="nobody@example.com")
    for method, path in [
        ("get", "/officer/complaints"),
        ("post", "/officer/complaints/1/claim"),
        ("post", "/officer/complaints/1/evidence-review"),
        ("patch", "/officer/complaints/1/status"),
        ("post", "/officer/complaints/batch-status"),
        ("post", "/officer/complaints/1/notes"),
        ("post", "/officer/clusters/1/notes"),
        ("get", "/officer/analytics"),
    ]:
        assert getattr(client, method)(API + path).status_code == 401
        assert getattr(client, method)(API + path, headers=auth_header(citizen)).status_code == 403


def test_queue_shows_only_this_officers_zone(seeded_app, client, session, officer_setup):
    officer, citizen, zone, headers = officer_setup
    other_zone = make_zone(session, code="ZN-2", name="Zone Two")
    cat = category(session)
    mine = make_complaint(session, citizen=citizen, zone=zone, category_row=cat, code="MINE")
    make_complaint(session, citizen=citizen, zone=other_zone, category_row=cat, code="THEIRS")

    body = client.get(f"{API}/officer/complaints", headers=headers).get_json()
    assert [row["id"] for row in body["data"]] == [str(mine.id)]
    assert body["pagination"]["totalItems"] == 1


def test_queue_never_exposes_reporter_identity(seeded_app, client, session, officer_setup):
    officer, citizen, zone, headers = officer_setup
    make_complaint(session, citizen=citizen, zone=zone, category_row=category(session))

    body = client.get(f"{API}/officer/complaints", headers=headers).get_json()
    assert "reporter" not in body["data"][0]
    assert citizen.full_name not in client.get(
        f"{API}/officer/complaints", headers=headers
    ).get_data(as_text=True)


# --- Queue filtering, sorting, pagination -------------------------------------


def test_queue_default_order_is_most_urgent_first(seeded_app, client, session, officer_setup):
    officer, citizen, zone, headers = officer_setup
    cat = category(session)
    make_complaint(
        session, citizen=citizen, zone=zone, category_row=cat, code="LOW", severity_score=1
    )
    make_complaint(
        session, citizen=citizen, zone=zone, category_row=cat, code="CRIT", severity_score=42
    )
    make_complaint(
        session, citizen=citizen, zone=zone, category_row=cat, code="MED", severity_score=7
    )

    body = client.get(f"{API}/officer/complaints", headers=headers).get_json()
    assert [row["severityLabel"] for row in body["data"]] == ["CRITICAL", "MEDIUM", "LOW"]


def test_queue_honours_the_sort_parameter(seeded_app, client, session, officer_setup):
    officer, citizen, zone, headers = officer_setup
    cat = category(session)
    older = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=cat,
        code="OLD",
        severity_score=90,
        now=datetime(2026, 6, 1, 9),
    )
    newer = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=cat,
        code="NEW",
        severity_score=1,
        now=datetime(2026, 7, 1, 9),
    )

    ascending = client.get(f"{API}/officer/complaints?sort=createdAt", headers=headers).get_json()
    assert [row["id"] for row in ascending["data"]] == [str(older.id), str(newer.id)]

    descending = client.get(
        f"{API}/officer/complaints?sort=-createdAt", headers=headers
    ).get_json()
    assert [row["id"] for row in descending["data"]] == [str(newer.id), str(older.id)]


def test_unrecognised_sort_falls_back_to_the_documented_default(
    seeded_app, client, session, officer_setup
):
    officer, citizen, zone, headers = officer_setup
    cat = category(session)
    make_complaint(
        session, citizen=citizen, zone=zone, category_row=cat, code="A", severity_score=2
    )
    make_complaint(
        session, citizen=citizen, zone=zone, category_row=cat, code="B", severity_score=50
    )

    response = client.get(f"{API}/officer/complaints?sort=nonsense", headers=headers)
    assert response.status_code == 200
    assert [row["severityLabel"] for row in response.get_json()["data"]] == ["CRITICAL", "LOW"]


def test_severity_filter_searches_the_whole_result_set_not_just_one_page(
    seeded_app, client, session, officer_setup
):
    """Regression: the filter used to run on the page AFTER pagination.

    With 3 low-severity complaints ahead of the critical one in id order and a
    page size of 2, a post-filter over page 1 finds nothing and reports
    totalItems 0. The filter belongs in the query.
    """
    officer, citizen, zone, headers = officer_setup
    cat = category(session)
    for index in range(3):
        make_complaint(
            session,
            citizen=citizen,
            zone=zone,
            category_row=cat,
            code=f"LOW-{index}",
            severity_score=0,
        )
    critical = make_complaint(
        session, citizen=citizen, zone=zone, category_row=cat, code="CRIT", severity_score=40
    )

    body = client.get(
        f"{API}/officer/complaints?severityLabel=CRITICAL&pageSize=2", headers=headers
    ).get_json()
    assert [row["id"] for row in body["data"]] == [str(critical.id)]
    assert body["pagination"]["totalItems"] == 1


def test_sla_filter_selects_overdue_across_the_result_set(
    seeded_app, client, session, officer_setup
):
    officer, citizen, zone, headers = officer_setup
    cat = category(session)
    long_ago = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=500)
    just_now = datetime.now(UTC).replace(tzinfo=None)
    overdue = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=cat,
        code="OVERDUE",
        status=ComplaintStatus.IN_PROGRESS,
        sla_target_hours=24,
        sla_started_at=long_ago,
    )
    make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=cat,
        code="ONTIME",
        status=ComplaintStatus.IN_PROGRESS,
        sla_target_hours=24,
        sla_started_at=just_now,
    )

    body = client.get(f"{API}/officer/complaints?slaLabel=OVERDUE", headers=headers).get_json()
    assert [row["id"] for row in body["data"]] == [str(overdue.id)]
    assert body["pagination"]["totalItems"] == 1


def test_queue_paginates(seeded_app, client, session, officer_setup):
    officer, citizen, zone, headers = officer_setup
    cat = category(session)
    for index in range(5):
        make_complaint(
            session, citizen=citizen, zone=zone, category_row=cat, code=f"C-{index}"
        )

    body = client.get(f"{API}/officer/complaints?page=2&pageSize=2", headers=headers).get_json()
    assert len(body["data"]) == 2
    assert body["pagination"] == {
        "page": 2,
        "pageSize": 2,
        "totalItems": 5,
        "totalPages": 3,
    }


# --- Claim / evidence review ---------------------------------------------------


def test_claim_moves_to_evidence_under_review_and_assigns(
    seeded_app, client, session, officer_setup
):
    officer, citizen, zone, headers = officer_setup
    complaint = make_complaint(session, citizen=citizen, zone=zone, category_row=category(session))

    body = client.post(f"{API}/officer/complaints/{complaint.id}/claim", headers=headers).get_json()
    assert body["status"] == "EVIDENCE_UNDER_REVIEW"
    assert body["assignedOfficerId"] == str(officer.id)
    assert "reporter" not in body


def test_second_claim_is_a_conflict(seeded_app, client, session, officer_setup):
    officer, citizen, zone, headers = officer_setup
    complaint = make_complaint(session, citizen=citizen, zone=zone, category_row=category(session))

    first = client.post(f"{API}/officer/complaints/{complaint.id}/claim", headers=headers)
    assert first.status_code == 200
    repeat = client.post(f"{API}/officer/complaints/{complaint.id}/claim", headers=headers)
    assert repeat.status_code == 409
    assert repeat.get_json()["error"]["code"] == "INVALID_TRANSITION"


def test_action_responses_carry_evidence_and_history(seeded_app, client, session, officer_setup):
    """Regression: claim / evidence-review / status returned empty arrays.

    The contract's 200 for all three is a ComplaintDetail, and the officer UI
    renders the evidence gallery and the timeline straight off that response.
    """
    officer, citizen, zone, headers = officer_setup
    complaint = make_complaint(session, citizen=citizen, zone=zone, category_row=category(session))

    claimed = client.post(
        f"{API}/officer/complaints/{complaint.id}/claim", headers=headers
    ).get_json()
    assert len(claimed["evidence"]) == 1
    assert claimed["evidence"][0]["photoUrl"].startswith("/api/v1/evidence/")
    assert [entry["toStatus"] for entry in claimed["statusHistory"]] == ["EVIDENCE_UNDER_REVIEW"]

    reviewed = client.post(
        f"{API}/officer/complaints/{complaint.id}/evidence-review",
        json={"verdict": "VALID"},
        headers=headers,
    ).get_json()
    assert len(reviewed["evidence"]) == 1
    assert reviewed["evidence"][0]["verdict"] == "VALID"
    assert [entry["toStatus"] for entry in reviewed["statusHistory"]] == [
        "EVIDENCE_UNDER_REVIEW",
        "UNDER_REVIEW",
    ]

    updated = client.patch(
        f"{API}/officer/complaints/{complaint.id}/status",
        json={"status": "IN_PROGRESS"},
        headers=headers,
    ).get_json()
    assert len(updated["complaint"]["evidence"]) == 1
    assert len(updated["complaint"]["statusHistory"]) == 3


def test_evidence_review_valid_starts_the_sla_clock(seeded_app, client, session, officer_setup):
    officer, citizen, zone, headers = officer_setup
    complaint = make_complaint(session, citizen=citizen, zone=zone, category_row=category(session))
    client.post(f"{API}/officer/complaints/{complaint.id}/claim", headers=headers)

    body = client.post(
        f"{API}/officer/complaints/{complaint.id}/evidence-review",
        json={"verdict": "VALID"},
        headers=headers,
    ).get_json()
    assert body["status"] == "UNDER_REVIEW"
    assert body["slaTargetHours"] == category(session).sla_hours
    assert body["slaLabel"] == "ON_TIME"


def test_evidence_review_requires_a_reason(seeded_app, client, session, officer_setup):
    officer, citizen, zone, headers = officer_setup
    complaint = make_complaint(session, citizen=citizen, zone=zone, category_row=category(session))
    client.post(f"{API}/officer/complaints/{complaint.id}/claim", headers=headers)

    response = client.post(
        f"{API}/officer/complaints/{complaint.id}/evidence-review",
        json={"verdict": "NEEDS_MORE_EVIDENCE"},
        headers=headers,
    )
    assert response.status_code == 400


def test_status_update_requires_a_reason_for_unresolvable(
    seeded_app, client, session, officer_setup
):
    officer, citizen, zone, headers = officer_setup
    complaint = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=category(session),
        status=ComplaintStatus.UNDER_REVIEW,
    )
    response = client.patch(
        f"{API}/officer/complaints/{complaint.id}/status",
        json={"status": "UNRESOLVABLE"},
        headers=headers,
    )
    assert response.status_code == 400


def test_status_update_rejects_an_illegal_jump(seeded_app, client, session, officer_setup):
    officer, citizen, zone, headers = officer_setup
    complaint = make_complaint(session, citizen=citizen, zone=zone, category_row=category(session))
    response = client.patch(
        f"{API}/officer/complaints/{complaint.id}/status",
        json={"status": "RESOLVED"},
        headers=headers,
    )
    assert response.status_code == 409


# --- Progress notes ------------------------------------------------------------


def test_progress_note_timestamp_is_utc_designated(seeded_app, client, session, officer_setup):
    """Regression: a bare isoformat() reads as LOCAL time in a browser."""
    officer, citizen, zone, headers = officer_setup
    complaint = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=category(session),
        status=ComplaintStatus.IN_PROGRESS,
    )
    response = client.post(
        f"{API}/officer/complaints/{complaint.id}/notes",
        json={"text": "Crew dispatched."},
        headers=headers,
    )
    assert response.status_code == 201
    assert response.get_json()["createdAt"].endswith("Z")


def test_progress_note_matches_the_detail_view_format(seeded_app, client, session, officer_setup):
    officer, citizen, zone, headers = officer_setup
    complaint = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=category(session),
        status=ComplaintStatus.IN_PROGRESS,
    )
    posted = client.post(
        f"{API}/officer/complaints/{complaint.id}/notes",
        json={"text": "Crew dispatched."},
        headers=headers,
    ).get_json()
    detail = client.get(f"{API}/complaints/{complaint.id}", headers=headers).get_json()
    assert detail["progressNotes"][0]["createdAt"] == posted["createdAt"]


def test_notes_are_rejected_outside_the_working_stages(
    seeded_app, client, session, officer_setup
):
    officer, citizen, zone, headers = officer_setup
    complaint = make_complaint(session, citizen=citizen, zone=zone, category_row=category(session))
    response = client.post(
        f"{API}/officer/complaints/{complaint.id}/notes",
        json={"text": "Too early."},
        headers=headers,
    )
    assert response.status_code == 409


# --- Public officer stats ------------------------------------------------------


def test_public_officer_stats_exposes_no_identity(seeded_app, client, session, officer_setup):
    officer, citizen, zone, headers = officer_setup

    body = client.get(f"{API}/officers/{officer.id}/stats", headers=headers).get_json()
    # A citizen may read this, so it must carry an ID and a count and nothing
    # else — never the officer's name.
    assert set(body) == {"officerId", "totalResolved"}
    assert body["officerId"] == str(officer.id)
