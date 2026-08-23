"""Rule-focused coverage for the non-AI admin endpoints."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.domain.enums import (
    ComplaintStatus,
    EvidenceVerdict,
    PointsReason,
    StatusActor,
    UserRole,
)
from app.models import (
    Complaint,
    ComplaintCategory,
    ComplaintCluster,
    ComplaintEvidence,
    ComplaintNote,
    ComplaintUpvote,
    PointsLedger,
    StatusHistory,
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


def make_zone(session, code="TEST", name="Test Zone"):
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
    officer=None,
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
        severity_score=0,
        created_at=created,
        updated_at=created,
    )
    session.add(complaint)
    session.commit()
    return complaint


@pytest.fixture
def admin_setup(seeded_app, session, auth_header):
    admin = session.query(User).filter_by(role=UserRole.ADMIN).first()
    zone = make_zone(session)
    return admin, zone, auth_header(admin)


def test_admin_routes_require_admin(seeded_app, client, session, auth_header):
    citizen = make_user(session, role=UserRole.CITIZEN, email="ordinary@example.com")
    endpoints = [
        ("get", "/admin/complaints"),
        ("patch", "/admin/complaints/1"),
        ("post", "/admin/complaints/1/dispute-review"),
        ("get", "/admin/users"),
        ("post", "/admin/users"),
        ("get", "/admin/users/1"),
        ("patch", "/admin/users/1"),
        ("delete", "/admin/users/1"),
        ("post", "/admin/zones"),
        ("patch", "/admin/zones/1"),
        ("delete", "/admin/zones/1"),
        ("post", "/admin/zones/1/assign-officer"),
        ("patch", "/admin/slas/1"),
        ("get", "/admin/settings"),
        ("patch", "/admin/settings"),
        ("get", "/admin/analytics"),
        ("get", "/admin/officers/1/performance"),
        ("get", "/admin/export/complaints"),
    ]
    for method, path in endpoints:
        assert getattr(client, method)(API + path).status_code == 401
        assert getattr(client, method)(API + path, headers=auth_header(citizen)).status_code == 403


def test_complaint_list_filters_sorts_and_paginates(seeded_app, client, session, admin_setup):
    _, zone, headers = admin_setup
    citizen = make_user(
        session, role=UserRole.CITIZEN, email="reporter@example.com", zone_id=zone.id
    )
    cat = category(session)
    first = make_complaint(session, citizen=citizen, zone=zone, category_row=cat, code="CMP-OLD")
    second = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=cat,
        code="CMP-NEW",
        status=ComplaintStatus.IN_PROGRESS,
        now=datetime(2026, 7, 2, 12),
    )
    response = client.get(
        f"{API}/admin/complaints?zoneId={zone.id}&status=IN_PROGRESS&page=1&pageSize=1",
        headers=headers,
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert [row["id"] for row in payload["data"]] == [str(second.id)]
    assert payload["pagination"] == {
        "page": 1,
        "pageSize": 1,
        "totalItems": 1,
        "totalPages": 1,
    }
    assert "reporter" not in payload["data"][0]
    assert first.id != second.id


def test_complaint_list_supports_every_documented_sort(
    seeded_app, client, session, admin_setup, monkeypatch
):
    _, zone, headers = admin_setup
    fixed_now = datetime(2026, 7, 10, 12)
    monkeypatch.setattr("app.api.admin.routes._utcnow", lambda: fixed_now)
    category_row = category(session)
    citizens = [
        make_user(session, role=UserRole.CITIZEN, email=f"sort-{index}@example.com")
        for index in range(6)
    ]
    rows = []
    for index in range(3):
        row = make_complaint(
            session,
            citizen=citizens[index],
            zone=zone,
            category_row=category_row,
            code=f"SORT-{index}",
            status=ComplaintStatus.IN_PROGRESS,
            now=datetime(2026, 7, index + 1, 12),
        )
        row.updated_at = datetime(2026, 7, 3 - index, 18)
        row.severity_score = 30 - index * 10
        row.sla_target_hours = 100
        row.sla_started_at = fixed_now - timedelta(hours=30 - index * 10)
        rows.append(row)
    session.add(ComplaintUpvote(complaint_id=rows[1].id, citizen_id=citizens[3].id))
    session.add_all(
        [
            ComplaintUpvote(complaint_id=rows[2].id, citizen_id=citizens[4].id),
            ComplaintUpvote(complaint_id=rows[2].id, citizen_id=citizens[5].id),
        ]
    )
    session.commit()

    expected = {
        "createdAt": rows,
        "-createdAt": list(reversed(rows)),
        "updatedAt": list(reversed(rows)),
        "-updatedAt": rows,
        "severity": list(reversed(rows)),
        "-severity": rows,
        "sla": list(reversed(rows)),
        "-sla": rows,
        "upvotes": rows,
        "-upvotes": list(reversed(rows)),
    }
    for sort, ordered in expected.items():
        response = client.get(f"{API}/admin/complaints?sort={sort}", headers=headers)
        assert response.status_code == 200
        assert [item["id"] for item in response.get_json()["data"]] == [
            str(row.id) for row in ordered
        ]


def test_complaint_list_combines_category_date_and_repeated_status_filters(
    seeded_app, client, session, admin_setup
):
    _, zone, headers = admin_setup
    categories = session.query(ComplaintCategory).order_by(ComplaintCategory.id).limit(2).all()
    citizen = make_user(session, role=UserRole.CITIZEN, email="combined-filter@example.com")
    included = [
        make_complaint(
            session,
            citizen=citizen,
            zone=zone,
            category_row=categories[0],
            code="FILTER-START",
            status=ComplaintStatus.SUBMITTED,
            now=datetime(2026, 7, 2, 0),
        ),
        make_complaint(
            session,
            citizen=citizen,
            zone=zone,
            category_row=categories[0],
            code="FILTER-END",
            status=ComplaintStatus.CLOSED,
            now=datetime(2026, 7, 3, 0),
        ),
    ]
    make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=categories[1],
        code="FILTER-WRONG-CATEGORY",
        status=ComplaintStatus.SUBMITTED,
        now=datetime(2026, 7, 2, 12),
    )
    make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=categories[0],
        code="FILTER-OUTSIDE-DATE",
        status=ComplaintStatus.SUBMITTED,
        now=datetime(2026, 7, 4, 0),
    )

    response = client.get(
        f"{API}/admin/complaints?categoryId={categories[0].id}"
        "&status=SUBMITTED&status=CLOSED"
        "&dateFrom=2026-07-02T00:00:00Z&dateTo=2026-07-03T00:00:00Z",
        headers=headers,
    )
    assert response.status_code == 200
    assert {item["id"] for item in response.get_json()["data"]} == {str(row.id) for row in included}


def test_complaint_list_sla_filter_uses_derived_clock(seeded_app, client, session, admin_setup):
    _, zone, headers = admin_setup
    citizen = make_user(session, role=UserRole.CITIZEN, email="sla@example.com")
    row = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=category(session),
        status=ComplaintStatus.IN_PROGRESS,
    )
    row.sla_target_hours = 1
    row.sla_started_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=2)
    session.commit()
    response = client.get(f"{API}/admin/complaints?slaLabel=OVERDUE", headers=headers)
    assert response.status_code == 200
    assert [item["id"] for item in response.get_json()["data"]] == [str(row.id)]


def test_complaint_list_sla_filter_is_exact_at_80_and_100_percent(
    seeded_app, client, session, admin_setup, monkeypatch
):
    _, zone, headers = admin_setup
    fixed_now = datetime(2026, 7, 10, 12)
    monkeypatch.setattr("app.api.admin.routes._utcnow", lambda: fixed_now)
    citizen = make_user(session, role=UserRole.CITIZEN, email="sla-boundaries@example.com")
    rows: dict[str, list[Complaint]] = {"ON_TIME": [], "DELAYED": [], "OVERDUE": []}
    for label, elapsed in (
        ("ON_TIME", timedelta(hours=79)),
        ("DELAYED", timedelta(hours=80)),
        ("OVERDUE", timedelta(hours=100)),
    ):
        row = make_complaint(
            session,
            citizen=citizen,
            zone=zone,
            category_row=category(session),
            code=f"SLA-{label}",
            status=ComplaintStatus.IN_PROGRESS,
        )
        row.sla_target_hours = 100
        row.sla_started_at = fixed_now - elapsed
        rows[label].append(row)
    paused = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=category(session),
        code="SLA-PAUSED-AT-80",
        status=ComplaintStatus.NEEDS_MORE_EVIDENCE,
    )
    paused.sla_target_hours = 100
    paused.sla_started_at = fixed_now - timedelta(hours=200)
    paused.sla_paused_at = fixed_now - timedelta(hours=120)
    rows["DELAYED"].append(paused)
    accumulated = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=category(session),
        code="SLA-PAUSED-SECONDS-AT-100",
        status=ComplaintStatus.IN_PROGRESS,
    )
    accumulated.sla_target_hours = 100
    accumulated.sla_started_at = fixed_now - timedelta(hours=101)
    accumulated.sla_paused_seconds = 3600
    rows["OVERDUE"].append(accumulated)
    session.commit()

    for label, expected in rows.items():
        response = client.get(f"{API}/admin/complaints?slaLabel={label}", headers=headers)
        assert response.status_code == 200
        payload = response.get_json()["data"]
        assert {item["id"] for item in payload} == {str(row.id) for row in expected}
        assert {item["slaLabel"] for item in payload} == {label}


def test_override_records_history_backfills_sla_and_exposes_reporter(
    seeded_app, client, session, admin_setup
):
    admin, zone, headers = admin_setup
    citizen = make_user(
        session, role=UserRole.CITIZEN, email="override@example.com", zone_id=zone.id
    )
    row = make_complaint(session, citizen=citizen, zone=zone, category_row=category(session))
    response = client.patch(
        f"{API}/admin/complaints/{row.id}",
        headers=headers,
        json={"status": "IN_PROGRESS", "reason": "Manual correction"},
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["status"] == "IN_PROGRESS"
    assert payload["slaTargetHours"] == category(session).sla_hours
    assert payload["slaLabel"] == "ON_TIME"
    assert payload["reporter"]["email"] == citizen.email
    history = session.query(StatusHistory).filter_by(complaint_id=row.id).one()
    assert history.actor_role is StatusActor.ADMIN
    assert history.changed_by_user_id == admin.id
    assert history.reason == "Manual correction"


def test_override_reclassifies_and_audits_without_changing_status(
    seeded_app, client, session, admin_setup
):
    _, zone, headers = admin_setup
    other_zone = make_zone(session, code="OTHER")
    categories = session.query(ComplaintCategory).order_by(ComplaintCategory.id).limit(2).all()
    citizen = make_user(session, role=UserRole.CITIZEN, email="move@example.com")
    row = make_complaint(session, citizen=citizen, zone=zone, category_row=categories[0])
    response = client.patch(
        f"{API}/admin/complaints/{row.id}",
        headers=headers,
        json={"zoneId": str(other_zone.id), "categoryId": str(categories[1].id)},
    )
    assert response.status_code == 200
    session.refresh(row)
    assert (row.zone_id, row.category_id) == (other_zone.id, categories[1].id)
    history = session.query(StatusHistory).filter_by(complaint_id=row.id).one()
    assert history.from_status is ComplaintStatus.SUBMITTED
    assert history.to_status is ComplaintStatus.SUBMITTED
    assert (
        client.patch(
            f"{API}/admin/complaints/{row.id}",
            headers=headers,
            json={"categoryId": "999999"},
        ).status_code
        == 400
    )
    assert (
        client.patch(
            f"{API}/admin/complaints/999999",
            headers=headers,
            json={"status": "CLOSED"},
        ).status_code
        == 404
    )


def test_override_zone_change_clears_only_incompatible_active_assignment(
    seeded_app, client, session, admin_setup
):
    _, old_zone, headers = admin_setup
    new_zone = make_zone(session, code="OVERRIDE-NEW")
    officer = make_user(
        session,
        role=UserRole.OFFICER,
        email="zone-override-officer@example.com",
        zone_id=old_zone.id,
    )
    citizen = make_user(session, role=UserRole.CITIZEN, email="zone-override@example.com")
    active = make_complaint(
        session,
        citizen=citizen,
        zone=old_zone,
        category_row=category(session),
        code="MOVE-ACTIVE",
        status=ComplaintStatus.IN_PROGRESS,
        officer=officer,
    )
    closed = make_complaint(
        session,
        citizen=citizen,
        zone=old_zone,
        category_row=category(session),
        code="MOVE-CLOSED",
        status=ComplaintStatus.CLOSED,
        officer=officer,
    )

    moved = client.patch(
        f"{API}/admin/complaints/{active.id}",
        headers=headers,
        json={"zoneId": str(new_zone.id)},
    )
    audited = client.patch(
        f"{API}/admin/complaints/{closed.id}",
        headers=headers,
        json={"zoneId": str(new_zone.id)},
    )
    assert moved.status_code == 200
    assert moved.get_json()["assignedOfficerId"] is None
    assert audited.status_code == 200
    assert audited.get_json()["assignedOfficerId"] == str(officer.id)
    session.refresh(active)
    session.refresh(closed)
    assert active.assigned_officer_id is None
    assert closed.assigned_officer_id == officer.id


@pytest.mark.parametrize(
    ("status", "timestamp_field"),
    [
        (ComplaintStatus.RESOLVED, "resolved_at"),
        (ComplaintStatus.CLOSED, "closed_at"),
    ],
)
def test_override_rejects_same_status_without_rewriting_business_timestamp(
    seeded_app, client, session, admin_setup, status, timestamp_field
):
    _, zone, headers = admin_setup
    citizen = make_user(
        session,
        role=UserRole.CITIZEN,
        email=f"same-{status.value.lower()}@example.com",
    )
    row = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=category(session),
        code=f"SAME-{status.value}",
        status=status,
    )
    original = datetime(2026, 7, 2, 8)
    setattr(row, timestamp_field, original)
    session.commit()

    response = client.patch(
        f"{API}/admin/complaints/{row.id}",
        headers=headers,
        json={"status": status.value},
    )
    assert response.status_code == 400
    session.refresh(row)
    assert getattr(row, timestamp_field) == original
    assert session.query(StatusHistory).filter_by(complaint_id=row.id).count() == 0


def test_override_classification_change_preserves_existing_resolution_timestamp(
    seeded_app, client, session, admin_setup
):
    _, zone, headers = admin_setup
    citizen = make_user(session, role=UserRole.CITIZEN, email="resolved-move@example.com")
    categories = session.query(ComplaintCategory).order_by(ComplaintCategory.id).limit(2).all()
    row = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=categories[0],
        code="RESOLVED-MOVE",
        status=ComplaintStatus.RESOLVED,
    )
    original = datetime(2026, 7, 2, 8)
    row.resolved_at = original
    session.commit()

    response = client.patch(
        f"{API}/admin/complaints/{row.id}",
        headers=headers,
        json={"status": "RESOLVED", "categoryId": str(categories[1].id)},
    )
    assert response.status_code == 200
    session.refresh(row)
    assert row.category_id == categories[1].id
    assert row.resolved_at == original
    history = session.query(StatusHistory).filter_by(complaint_id=row.id).one()
    assert history.from_status is ComplaintStatus.RESOLVED
    assert history.to_status is ComplaintStatus.RESOLVED


def test_override_cluster_detach_recomputes_every_member_and_detached_complaint(
    seeded_app, client, session, admin_setup
):
    _, zone, headers = admin_setup
    categories = session.query(ComplaintCategory).order_by(ComplaintCategory.id).limit(2).all()
    cluster = ComplaintCluster(
        category_id=categories[0].id,
        zone_id=zone.id,
        centroid_lat=12.9,
        centroid_lng=77.6,
        report_count=4,
        unique_reporter_count=4,
        reward_granted=False,
    )
    session.add(cluster)
    session.commit()
    members = []
    for index in range(4):
        citizen = make_user(
            session,
            role=UserRole.CITIZEN,
            email=f"cluster-detach-{index}@example.com",
        )
        member = make_complaint(
            session,
            citizen=citizen,
            zone=zone,
            category_row=categories[0],
            code=f"DETACH-{index}",
        )
        member.cluster_id = cluster.id
        member.severity_score = 9
        members.append(member)
    session.commit()

    response = client.patch(
        f"{API}/admin/complaints/{members[0].id}",
        headers=headers,
        json={"categoryId": str(categories[1].id)},
    )
    assert response.status_code == 200
    for member in members:
        session.refresh(member)
    session.refresh(cluster)
    assert members[0].cluster_id is None
    assert members[0].severity_score == 0
    assert cluster.report_count == 3
    assert cluster.unique_reporter_count == 3
    assert {member.severity_score for member in members[1:]} == {6}


def test_override_relinks_reclassified_complaint_to_nearby_matching_standalone(
    seeded_app, client, session, admin_setup
):
    _, zone, headers = admin_setup
    categories = session.query(ComplaintCategory).order_by(ComplaintCategory.id).limit(2).all()
    citizens = [
        make_user(
            session,
            role=UserRole.CITIZEN,
            email=f"cluster-relink-{index}@example.com",
        )
        for index in range(3)
    ]
    old_cluster = ComplaintCluster(
        category_id=categories[0].id,
        zone_id=zone.id,
        centroid_lat=12.9,
        centroid_lng=77.6,
        report_count=2,
        unique_reporter_count=2,
        reward_granted=False,
    )
    session.add(old_cluster)
    session.commit()
    mover = make_complaint(
        session,
        citizen=citizens[0],
        zone=zone,
        category_row=categories[0],
        code="RELINK-MOVER",
    )
    old_peer = make_complaint(
        session,
        citizen=citizens[1],
        zone=zone,
        category_row=categories[0],
        code="RELINK-OLD",
    )
    candidate = make_complaint(
        session,
        citizen=citizens[2],
        zone=zone,
        category_row=categories[1],
        code="RELINK-CANDIDATE",
    )
    mover.cluster_id = old_cluster.id
    old_peer.cluster_id = old_cluster.id
    mover.severity_score = old_peer.severity_score = 3
    session.commit()

    response = client.patch(
        f"{API}/admin/complaints/{mover.id}",
        headers=headers,
        json={"categoryId": str(categories[1].id)},
    )
    assert response.status_code == 200
    session.refresh(mover)
    session.refresh(old_peer)
    session.refresh(candidate)
    assert old_peer.cluster_id is None
    assert old_peer.severity_score == 0
    assert mover.cluster_id is not None
    assert mover.cluster_id == candidate.cluster_id
    assert {mover.severity_score, candidate.severity_score} == {3}
    replacement = session.get(ComplaintCluster, mover.cluster_id)
    assert replacement is not None
    assert replacement.category_id == categories[1].id
    assert replacement.report_count == 2
    assert replacement.unique_reporter_count == 2
    assert session.query(ComplaintCluster).filter_by(category_id=categories[0].id).count() == 0


def test_override_relinks_reclassified_complaint_to_nearest_existing_cluster(
    seeded_app, client, session, admin_setup
):
    _, zone, headers = admin_setup
    categories = session.query(ComplaintCategory).order_by(ComplaintCategory.id).limit(2).all()
    citizens = [
        make_user(
            session,
            role=UserRole.CITIZEN,
            email=f"existing-cluster-{index}@example.com",
        )
        for index in range(4)
    ]
    old_cluster = ComplaintCluster(
        category_id=categories[0].id,
        zone_id=zone.id,
        centroid_lat=12.9,
        centroid_lng=77.6,
        report_count=2,
        unique_reporter_count=2,
        reward_granted=False,
    )
    target_cluster = ComplaintCluster(
        category_id=categories[1].id,
        zone_id=zone.id,
        centroid_lat=12.9,
        centroid_lng=77.6,
        report_count=2,
        unique_reporter_count=2,
        reward_granted=False,
    )
    session.add_all([old_cluster, target_cluster])
    session.commit()
    mover = make_complaint(
        session,
        citizen=citizens[0],
        zone=zone,
        category_row=categories[0],
        code="EXISTING-MOVER",
    )
    old_peer = make_complaint(
        session,
        citizen=citizens[1],
        zone=zone,
        category_row=categories[0],
        code="EXISTING-OLD",
    )
    target_members = [
        make_complaint(
            session,
            citizen=citizens[index],
            zone=zone,
            category_row=categories[1],
            code=f"EXISTING-TARGET-{index}",
        )
        for index in (2, 3)
    ]
    mover.cluster_id = old_peer.cluster_id = old_cluster.id
    for member in target_members:
        member.cluster_id = target_cluster.id
    for member in [mover, old_peer, *target_members]:
        member.severity_score = 3
    session.commit()

    response = client.patch(
        f"{API}/admin/complaints/{mover.id}",
        headers=headers,
        json={"categoryId": str(categories[1].id)},
    )
    assert response.status_code == 200
    session.refresh(mover)
    session.refresh(old_peer)
    session.refresh(target_cluster)
    assert mover.cluster_id == target_cluster.id
    assert old_peer.cluster_id is None
    assert old_peer.severity_score == 0
    assert target_cluster.report_count == 3
    assert target_cluster.unique_reporter_count == 3
    for member in [mover, *target_members]:
        session.refresh(member)
        assert member.severity_score == 6


def test_override_validation_failure_rolls_back_classification_and_cluster(
    seeded_app, client, session, admin_setup
):
    _, zone, headers = admin_setup
    categories = session.query(ComplaintCategory).order_by(ComplaintCategory.id).limit(2).all()
    citizens = [
        make_user(
            session,
            role=UserRole.CITIZEN,
            email=f"rollback-cluster-{index}@example.com",
        )
        for index in range(2)
    ]
    cluster = ComplaintCluster(
        category_id=categories[0].id,
        zone_id=zone.id,
        centroid_lat=12.9,
        centroid_lng=77.6,
        report_count=2,
        unique_reporter_count=2,
        reward_granted=False,
    )
    session.add(cluster)
    session.commit()
    rows = [
        make_complaint(
            session,
            citizen=citizen,
            zone=zone,
            category_row=categories[0],
            code=f"ROLLBACK-{index}",
        )
        for index, citizen in enumerate(citizens)
    ]
    for row in rows:
        row.cluster_id = cluster.id
        row.severity_score = 3
    session.commit()

    response = client.patch(
        f"{API}/admin/complaints/{rows[0].id}",
        headers=headers,
        json={"categoryId": str(categories[1].id), "zoneId": "999999"},
    )
    assert response.status_code == 400
    for row in rows:
        session.refresh(row)
        assert row.cluster_id == cluster.id
        assert row.category_id == categories[0].id
        assert row.severity_score == 3
    session.refresh(cluster)
    assert cluster.report_count == 2
    assert session.query(StatusHistory).filter_by(complaint_id=rows[0].id).count() == 0


@pytest.mark.parametrize(
    ("verdict", "expected"),
    [("UPHELD", ComplaintStatus.IN_PROGRESS), ("REJECTED", ComplaintStatus.CLOSED)],
)
def test_dispute_review_is_only_exit_and_awards_no_points(
    seeded_app, client, session, admin_setup, verdict, expected
):
    _, zone, headers = admin_setup
    citizen = make_user(session, role=UserRole.CITIZEN, email=f"{verdict}@example.com")
    row = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=category(session),
        code=f"CMP-{verdict}",
        status=ComplaintStatus.REOPENED,
    )
    response = client.post(
        f"{API}/admin/complaints/{row.id}/dispute-review",
        headers=headers,
        json={"verdict": verdict, "reason": "Evidence considered"},
    )
    assert response.status_code == 200
    session.refresh(row)
    assert row.status is expected
    assert session.query(PointsLedger).filter_by(complaint_id=row.id).count() == 0
    if verdict == "REJECTED":
        assert row.closed_at is not None


def test_dispute_review_rejects_wrong_state_and_blank_reason(
    seeded_app, client, session, admin_setup
):
    _, zone, headers = admin_setup
    citizen = make_user(session, role=UserRole.CITIZEN, email="bad-dispute@example.com")
    row = make_complaint(session, citizen=citizen, zone=zone, category_row=category(session))
    wrong_state = client.post(
        f"{API}/admin/complaints/{row.id}/dispute-review",
        headers=headers,
        json={"verdict": "UPHELD", "reason": "Valid reason"},
    )
    assert wrong_state.status_code == 409
    blank = client.post(
        f"{API}/admin/complaints/{row.id}/dispute-review",
        headers=headers,
        json={"verdict": "UPHELD", "reason": "   "},
    )
    assert blank.status_code == 400


def test_dispute_review_rejects_unknown_malformed_and_repeat_requests(
    seeded_app, client, session, admin_setup
):
    _, zone, headers = admin_setup
    citizen = make_user(session, role=UserRole.CITIZEN, email="repeat-dispute@example.com")
    row = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=category(session),
        code="REPEAT-DISPUTE",
        status=ComplaintStatus.REOPENED,
    )
    assert (
        client.post(
            f"{API}/admin/complaints/999999/dispute-review",
            headers=headers,
            json={"verdict": "UPHELD", "reason": "Reviewed"},
        ).status_code
        == 404
    )
    for body in (
        {"verdict": "UNKNOWN", "reason": "Reviewed"},
        {"verdict": "UPHELD"},
        {"verdict": "UPHELD", "reason": "Reviewed", "unexpected": True},
    ):
        assert (
            client.post(
                f"{API}/admin/complaints/{row.id}/dispute-review",
                headers=headers,
                json=body,
            ).status_code
            == 400
        )

    first = client.post(
        f"{API}/admin/complaints/{row.id}/dispute-review",
        headers=headers,
        json={"verdict": "UPHELD", "reason": "Reviewed once"},
    )
    second = client.post(
        f"{API}/admin/complaints/{row.id}/dispute-review",
        headers=headers,
        json={"verdict": "UPHELD", "reason": "Reviewed twice"},
    )
    assert first.status_code == 200
    assert second.status_code == 409
    histories = session.query(StatusHistory).filter_by(complaint_id=row.id).all()
    assert len(histories) == 1
    assert histories[0].reason == "Reviewed once"


def test_user_create_list_get_and_validation(seeded_app, client, session, admin_setup):
    _, zone, headers = admin_setup
    created = client.post(
        f"{API}/admin/users",
        headers=headers,
        json={
            "role": "OFFICER",
            "name": "New Officer",
            "email": "new.officer@example.com",
            "password": "password123",
            "zoneId": str(zone.id),
        },
    )
    assert created.status_code == 201
    user_id = created.get_json()["id"]
    assert created.get_json()["zoneId"] == str(zone.id)
    assert client.get(f"{API}/admin/users/{user_id}", headers=headers).status_code == 200
    listed = client.get(
        f"{API}/admin/users?role=OFFICER&zoneId={zone.id}&active=true", headers=headers
    ).get_json()
    assert user_id in [row["id"] for row in listed["data"]]
    no_zone = client.post(
        f"{API}/admin/users",
        headers=headers,
        json={
            "role": "OFFICER",
            "name": "No Zone",
            "email": "no.zone@example.com",
            "password": "password123",
        },
    )
    assert no_zone.status_code == 400
    admin_role = client.post(
        f"{API}/admin/users",
        headers=headers,
        json={
            "role": "ADMIN",
            "name": "No Admin",
            "email": "no.admin@example.com",
            "password": "password123",
        },
    )
    assert admin_role.status_code == 400
    duplicate = client.post(
        f"{API}/admin/users",
        headers=headers,
        json={
            "role": "CITIZEN",
            "name": "Duplicate",
            "email": "NEW.OFFICER@example.com",
            "password": "password123",
        },
    )
    assert duplicate.status_code == 409
    assert duplicate.get_json()["error"]["code"] == "EMAIL_TAKEN"


def test_user_update_reassigns_officer_and_clears_only_old_nonterminal(
    seeded_app, client, session, admin_setup
):
    _, old_zone, headers = admin_setup
    new_zone = make_zone(session, code="NEW")
    officer = make_user(
        session, role=UserRole.OFFICER, email="officer@example.com", zone_id=old_zone.id
    )
    citizen = make_user(session, role=UserRole.CITIZEN, email="owner@example.com")
    open_row = make_complaint(
        session,
        citizen=citizen,
        zone=old_zone,
        category_row=category(session),
        code="OPEN",
        status=ComplaintStatus.IN_PROGRESS,
        officer=officer,
    )
    closed_row = make_complaint(
        session,
        citizen=citizen,
        zone=old_zone,
        category_row=category(session),
        code="CLOSED",
        status=ComplaintStatus.CLOSED,
        officer=officer,
    )
    response = client.patch(
        f"{API}/admin/users/{officer.id}",
        headers=headers,
        json={"zoneId": str(new_zone.id), "active": False, "name": "Renamed"},
    )
    assert response.status_code == 200
    session.refresh(open_row)
    session.refresh(closed_row)
    assert open_row.assigned_officer_id is None
    assert closed_row.assigned_officer_id == officer.id
    assert response.get_json()["active"] is False


def test_user_update_rejects_duplicate_email_and_unknown_user(
    seeded_app, client, session, admin_setup
):
    _, _, headers = admin_setup
    first = make_user(session, role=UserRole.CITIZEN, email="first@example.com")
    second = make_user(session, role=UserRole.CITIZEN, email="second@example.com")
    duplicate = client.patch(
        f"{API}/admin/users/{second.id}",
        headers=headers,
        json={"email": first.email.upper()},
    )
    assert duplicate.status_code == 409
    assert duplicate.get_json()["error"]["code"] == "EMAIL_TAKEN"
    assert client.get(f"{API}/admin/users/999999", headers=headers).status_code == 404


def test_user_delete_allows_empty_account_and_reports_blockers(
    seeded_app, client, session, admin_setup
):
    _, zone, headers = admin_setup
    empty = make_user(session, role=UserRole.CITIZEN, email="empty@example.com")
    assert client.delete(f"{API}/admin/users/{empty.id}", headers=headers).status_code == 204
    citizen = make_user(session, role=UserRole.CITIZEN, email="linked@example.com")
    make_complaint(
        session, citizen=citizen, zone=zone, category_row=category(session), code="LINKED"
    )
    blocked = client.delete(f"{API}/admin/users/{citizen.id}", headers=headers)
    assert blocked.status_code == 409
    assert blocked.get_json()["error"]["code"] == "HAS_LINKED_RECORDS"
    assert "complaintsFiled=1" in blocked.get_json()["error"]["message"]


def test_user_delete_reports_every_audit_blocker_without_partial_deletion(
    seeded_app, client, session, admin_setup
):
    _, zone, headers = admin_setup
    officer = make_user(
        session,
        role=UserRole.OFFICER,
        email="delete-blocked-officer@example.com",
        zone_id=zone.id,
    )
    citizen = make_user(session, role=UserRole.CITIZEN, email="delete-blocker-owner@example.com")
    row = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=category(session),
        code="DELETE-BLOCKERS",
        status=ComplaintStatus.IN_PROGRESS,
        officer=officer,
    )
    session.add_all(
        [
            ComplaintNote(complaint_id=row.id, officer_id=officer.id, note_text="Audit note"),
            ComplaintEvidence(
                complaint_id=row.id,
                sequence=1,
                file_path="audit.jpg",
                verdict=EvidenceVerdict.VALID,
                reviewed_by=officer.id,
                reviewed_at=datetime(2026, 7, 2, 8),
            ),
            StatusHistory(
                complaint_id=row.id,
                from_status=ComplaintStatus.UNDER_REVIEW,
                to_status=ComplaintStatus.IN_PROGRESS,
                actor_role=StatusActor.OFFICER,
                changed_by_user_id=officer.id,
            ),
        ]
    )
    session.commit()

    response = client.delete(f"{API}/admin/users/{officer.id}", headers=headers)
    assert response.status_code == 409
    details = {item["field"]: item["issue"] for item in response.get_json()["error"]["details"]}
    assert details == {
        "complaintsAssigned": "1",
        "progressNotes": "1",
        "evidenceReviews": "1",
        "statusHistory": "1",
    }
    assert session.get(User, officer.id) is not None

    ledger_owner = make_user(
        session,
        role=UserRole.CITIZEN,
        email="delete-ledger-owner@example.com",
    )
    session.add(
        PointsLedger(
            citizen_id=ledger_owner.id,
            points_change=5,
            reason=PointsReason.UPVOTE_RECEIVED,
        )
    )
    session.commit()
    ledger_response = client.delete(f"{API}/admin/users/{ledger_owner.id}", headers=headers)
    assert ledger_response.status_code == 409
    assert ledger_response.get_json()["error"]["details"] == [{"field": "ledgerRows", "issue": "1"}]
    assert client.delete(f"{API}/admin/users/999999", headers=headers).status_code == 404


def test_zone_crud_invariants(seeded_app, client, session, admin_setup):
    _, _, headers = admin_setup
    created = client.post(
        f"{API}/admin/zones",
        headers=headers,
        json={"code": "WARD-X", "name": "Ward X", "centerLat": 1, "centerLng": 2},
    )
    assert created.status_code == 201
    zone_id = created.get_json()["id"]
    duplicate = client.post(
        f"{API}/admin/zones",
        headers=headers,
        json={"code": "WARD-X", "name": "Again", "centerLat": 1, "centerLng": 2},
    )
    assert duplicate.status_code == 409
    renamed = client.patch(
        f"{API}/admin/zones/{zone_id}", headers=headers, json={"name": "Renamed"}
    )
    assert renamed.status_code == 200
    assert renamed.get_json()["code"] == "WARD-X"
    assert client.delete(f"{API}/admin/zones/{zone_id}", headers=headers).status_code == 204
    catch_all = session.query(Zone).filter_by(is_catch_all=True).one()
    assert (
        client.patch(
            f"{API}/admin/zones/{catch_all.id}", headers=headers, json={"isActive": False}
        ).status_code
        == 400
    )
    assert client.delete(f"{API}/admin/zones/{catch_all.id}", headers=headers).status_code == 409


def test_zone_delete_reports_usage_and_unknown_zone(seeded_app, client, session, admin_setup):
    _, zone, headers = admin_setup
    make_user(session, role=UserRole.CITIZEN, email="zone-user@example.com", zone_id=zone.id)
    response = client.delete(f"{API}/admin/zones/{zone.id}", headers=headers)
    assert response.status_code == 409
    assert "citizens=1" in response.get_json()["error"]["message"]
    assert client.delete(f"{API}/admin/zones/999999", headers=headers).status_code == 404


def test_zone_delete_reports_complaint_and_officer_blockers_together(
    seeded_app, client, session, admin_setup
):
    _, zone, headers = admin_setup
    officer = make_user(
        session,
        role=UserRole.OFFICER,
        email="zone-delete-officer@example.com",
        zone_id=zone.id,
    )
    citizen = make_user(session, role=UserRole.CITIZEN, email="zone-delete-owner@example.com")
    make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=category(session),
        code="ZONE-DELETE-BLOCKER",
        officer=officer,
    )

    response = client.delete(f"{API}/admin/zones/{zone.id}", headers=headers)
    assert response.status_code == 409
    details = {item["field"]: item["issue"] for item in response.get_json()["error"]["details"]}
    assert details == {"complaints": "1", "officers": "1"}
    assert session.get(Zone, zone.id) is not None


def test_assign_officer_endpoint_and_invalid_user(seeded_app, client, session, admin_setup):
    _, zone, headers = admin_setup
    officer = make_user(session, role=UserRole.OFFICER, email="assign@example.com")
    citizen = make_user(session, role=UserRole.CITIZEN, email="not-officer@example.com")
    assigned = client.post(
        f"{API}/admin/zones/{zone.id}/assign-officer",
        headers=headers,
        json={"officerId": str(officer.id)},
    )
    assert assigned.status_code == 200
    assert assigned.get_json()["zoneId"] == str(zone.id)
    invalid = client.post(
        f"{API}/admin/zones/{zone.id}/assign-officer",
        headers=headers,
        json={"officerId": str(citizen.id)},
    )
    assert invalid.status_code == 400
    assert (
        client.post(
            f"{API}/admin/zones/{zone.id}/assign-officer",
            headers=headers,
            json={"officerId": "999999"},
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"{API}/admin/zones/999999/assign-officer",
            headers=headers,
            json={"officerId": str(officer.id)},
        ).status_code
        == 404
    )


def test_sla_update_is_prospective(seeded_app, client, session, admin_setup):
    _, zone, headers = admin_setup
    cat = category(session)
    citizen = make_user(session, role=UserRole.CITIZEN, email="future-sla@example.com")
    row = make_complaint(session, citizen=citizen, zone=zone, category_row=cat)
    row.sla_target_hours = cat.sla_hours
    old_snapshot = row.sla_target_hours
    session.commit()
    response = client.patch(
        f"{API}/admin/slas/{cat.id}", headers=headers, json={"targetHours": 999}
    )
    assert response.status_code == 200
    session.refresh(row)
    assert row.sla_target_hours == old_snapshot
    assert (
        client.patch(
            f"{API}/admin/slas/{cat.id}", headers=headers, json={"targetHours": 0}
        ).status_code
        == 400
    )
    assert (
        client.patch(
            f"{API}/admin/slas/999999", headers=headers, json={"targetHours": 24}
        ).status_code
        == 404
    )
    for body in ({}, {"targetHours": 24, "unexpected": True}, {"targetHours": 1.5}):
        assert (
            client.patch(f"{API}/admin/slas/{cat.id}", headers=headers, json=body).status_code
            == 400
        )


def test_settings_get_update_and_validation(seeded_app, client, admin_setup):
    _, _, headers = admin_setup
    assert client.get(f"{API}/admin/settings", headers=headers).get_json() == {
        "autoCloseTimeoutHours": 168
    }
    updated = client.patch(
        f"{API}/admin/settings", headers=headers, json={"autoCloseTimeoutHours": 24}
    )
    assert updated.get_json() == {"autoCloseTimeoutHours": 24}
    assert (
        client.patch(
            f"{API}/admin/settings", headers=headers, json={"autoCloseTimeoutHours": 0}
        ).status_code
        == 400
    )
    for body in (
        {},
        {"autoCloseTimeoutHours": 24, "unexpected": True},
        {"autoCloseTimeoutHours": 1.5},
    ):
        assert client.patch(f"{API}/admin/settings", headers=headers, json=body).status_code == 400


def test_query_validation_rejects_unknown_fields_and_bad_period(seeded_app, client, admin_setup):
    _, _, headers = admin_setup
    assert client.get(f"{API}/admin/complaints?pageSize=101", headers=headers).status_code == 400
    assert client.get(f"{API}/admin/users?unexpected=true", headers=headers).status_code == 400
    assert (
        client.get(
            f"{API}/admin/export/complaints?dateFrom=2026-01-01T00:00:00Z",
            headers=headers,
        ).status_code
        == 200
    )
    assert (
        client.get(
            f"{API}/admin/export/complaints?startDate=2026-01-01T00:00:00Z",
            headers=headers,
        ).status_code
        == 400
    )
    assert (
        client.get(
            f"{API}/admin/officers/1/performance?period=quarter", headers=headers
        ).status_code
        == 400
    )


def test_system_analytics_and_officer_performance(seeded_app, client, session, admin_setup):
    _, zone, headers = admin_setup
    officer = make_user(
        session, role=UserRole.OFFICER, email="metrics@example.com", zone_id=zone.id
    )
    citizen = make_user(
        session, role=UserRole.CITIZEN, email="metrics-citizen@example.com", zone_id=zone.id
    )
    now = datetime.now(UTC).replace(tzinfo=None)
    row = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=category(session),
        code="METRIC",
        status=ComplaintStatus.RESOLVED,
        officer=officer,
        now=now - timedelta(hours=2),
    )
    row.sla_target_hours = 10
    row.sla_started_at = now - timedelta(hours=2)
    row.resolved_at = now - timedelta(hours=1)
    evidence = ComplaintEvidence(
        complaint_id=row.id,
        sequence=1,
        file_path="test.jpg",
        verdict=EvidenceVerdict.VALID,
        reviewed_by=officer.id,
        reviewed_at=now,
    )
    history = StatusHistory(
        complaint_id=row.id,
        from_status=ComplaintStatus.UNDER_RESOLUTION,
        to_status=ComplaintStatus.RESOLVED,
        actor_role=StatusActor.OFFICER,
        changed_by_user_id=officer.id,
        created_at=row.resolved_at,
    )
    points = PointsLedger(
        citizen_id=citizen.id,
        complaint_id=row.id,
        points_change=5,
        reason=PointsReason.UPVOTE_RECEIVED,
    )
    session.add_all([evidence, history, points])
    session.commit()

    analytics = client.get(f"{API}/admin/analytics", headers=headers)
    assert analytics.status_code == 200
    metric = next(item for item in analytics.get_json()["zones"] if item["zoneId"] == str(zone.id))
    assert metric["resolvedThisMonth"] == 1
    assert metric["topCitizens"][0]["citizenId"] == str(citizen.id)

    performance = client.get(
        f"{API}/admin/officers/{officer.id}/performance?period=all_time", headers=headers
    )
    assert performance.status_code == 200
    payload = performance.get_json()
    assert payload["totalHandled"] == 1
    assert payload["onTime"] == 1
    assert payload["evidenceBreakdown"]["valid"] == 1
    assert payload["avgResolutionHours"] == pytest.approx(1.0)
    assert (
        client.get(f"{API}/admin/officers/{citizen.id}/performance", headers=headers).status_code
        == 404
    )


def test_officer_resolution_average_follows_latest_history_not_current_assignment(
    seeded_app, client, session, admin_setup, monkeypatch
):
    _, zone, headers = admin_setup
    fixed_now = datetime(2026, 7, 20, 12)
    monkeypatch.setattr("app.api.admin.routes._utcnow", lambda: fixed_now)
    resolver = make_user(
        session,
        role=UserRole.OFFICER,
        email="historical-resolver@example.com",
        zone_id=zone.id,
    )
    current_assignee = make_user(
        session,
        role=UserRole.OFFICER,
        email="current-assignee@example.com",
        zone_id=zone.id,
    )
    citizen = make_user(session, role=UserRole.CITIZEN, email="history-owner@example.com")
    row = make_complaint(
        session,
        citizen=citizen,
        zone=zone,
        category_row=category(session),
        code="HISTORY-ATTRIBUTION",
        status=ComplaintStatus.RESOLVED,
        officer=current_assignee,
        now=fixed_now - timedelta(hours=3),
    )
    row.sla_target_hours = 10
    row.sla_started_at = fixed_now - timedelta(hours=2)
    row.resolved_at = fixed_now - timedelta(hours=1)
    session.add(
        StatusHistory(
            complaint_id=row.id,
            from_status=ComplaintStatus.UNDER_RESOLUTION,
            to_status=ComplaintStatus.RESOLVED,
            actor_role=StatusActor.OFFICER,
            changed_by_user_id=resolver.id,
            created_at=row.resolved_at,
        )
    )
    session.commit()

    resolver_payload = client.get(
        f"{API}/admin/officers/{resolver.id}/performance?period=all_time",
        headers=headers,
    ).get_json()
    assignee_payload = client.get(
        f"{API}/admin/officers/{current_assignee.id}/performance?period=all_time",
        headers=headers,
    ).get_json()
    assert resolver_payload["totalHandled"] == 0
    assert resolver_payload["avgResolutionHours"] == pytest.approx(1.0)
    assert assignee_payload["totalHandled"] == 1
    assert assignee_payload["avgResolutionHours"] is None


# --- The admin lockout guard -------------------------------------------------
#
# There is no API that mints an ADMIN (`CreateUserRequest.role` is CITIZEN or
# OFFICER only) and a deactivated account cannot log in, so leaving zero active
# admins is unrecoverable without database surgery. These lock that shut.


def test_admin_cannot_deactivate_their_own_account(seeded_app, client, session, auth_header):
    admin = make_user(session, role=UserRole.ADMIN, email="self.deact@kartavya.gov")

    response = client.patch(
        f"{API}/admin/users/{admin.id}", json={"active": False}, headers=auth_header(admin)
    )

    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "LAST_ADMIN"
    session.refresh(admin)
    assert admin.is_active is True


def test_admin_cannot_delete_their_own_account(seeded_app, client, session, auth_header):
    """A brand-new admin has no linked records, so HAS_LINKED_RECORDS won't save us."""
    admin = make_user(session, role=UserRole.ADMIN, email="self.del@kartavya.gov")

    response = client.delete(f"{API}/admin/users/{admin.id}", headers=auth_header(admin))

    assert response.status_code == 409
    assert response.get_json()["error"]["code"] == "LAST_ADMIN"
    assert session.get(User, admin.id) is not None


def test_deactivating_the_last_active_admin_is_refused_at_the_service(seeded_app, session):
    """The count guard, exercised where it is actually reachable.

    Over HTTP this branch is unreachable: the acting admin is loaded fresh on
    every request, so an admin who is not themselves active gets 401 long
    before the guard runs, and any *active* actor is themselves a remaining
    admin. It stays as a safety net for non-HTTP callers (a CLI, a job, a
    future bulk import), and this is the only honest way to prove it works.
    """
    from app.domain.errors import ConflictError
    from app.services.accounts.users import update_user as update_user_service

    with seeded_app.app_context():
        seeded = session.query(User).filter(User.role == UserRole.ADMIN).one()
        ghost_actor_id = seeded.id + 1000  # not an admin, not even a real row

        with pytest.raises(ConflictError) as caught:
            update_user_service(
                user_id=seeded.id,
                acting_admin_id=ghost_actor_id,
                full_name=None,
                email=None,
                zone_id=None,
                change_zone=False,
                active=False,
            )

        assert caught.value.code == "LAST_ADMIN"
        session.refresh(seeded)
        assert seeded.is_active is True


def test_admin_may_deactivate_another_admin_when_one_remains(
    seeded_app, client, session, auth_header
):
    """The guard protects the last way in, not admin accounts in general."""
    actor = make_user(session, role=UserRole.ADMIN, email="keeper@kartavya.gov")
    spare = make_user(session, role=UserRole.ADMIN, email="spare@kartavya.gov")

    response = client.patch(
        f"{API}/admin/users/{spare.id}", json={"active": False}, headers=auth_header(actor)
    )

    assert response.status_code == 200
    session.refresh(spare)
    assert spare.is_active is False


def test_deactivating_a_citizen_is_untouched_by_the_guard(seeded_app, client, session, auth_header):
    admin = make_user(session, role=UserRole.ADMIN, email="guard.citizen@kartavya.gov")
    citizen = make_user(session, role=UserRole.CITIZEN, email="ordinary@example.com")

    response = client.patch(
        f"{API}/admin/users/{citizen.id}", json={"active": False}, headers=auth_header(admin)
    )

    assert response.status_code == 200
    session.refresh(citizen)
    assert citizen.is_active is False


# --- Admin-initiated password reset ------------------------------------------


def test_admin_reset_password_lets_the_user_log_in_with_the_new_one(
    seeded_app, client, session, auth_header
):
    admin = make_user(session, role=UserRole.ADMIN, email="resetter@kartavya.gov")
    citizen = make_user(session, role=UserRole.CITIZEN, email="forgot@example.com")

    response = client.post(
        f"{API}/admin/users/{citizen.id}/reset-password",
        json={"newPassword": "brand-new-password"},
        headers=auth_header(admin),
    )
    assert response.status_code == 204

    fresh = client.post(
        f"{API}/auth/login",
        json={"email": "forgot@example.com", "password": "brand-new-password"},
    )
    assert fresh.status_code == 200
    stale = client.post(
        f"{API}/auth/login", json={"email": "forgot@example.com", "password": "password123"}
    )
    assert stale.status_code == 401


def test_admin_reset_password_rejects_a_short_password(seeded_app, client, session, auth_header):
    admin = make_user(session, role=UserRole.ADMIN, email="shortpw@kartavya.gov")
    citizen = make_user(session, role=UserRole.CITIZEN, email="shortpw@example.com")

    response = client.post(
        f"{API}/admin/users/{citizen.id}/reset-password",
        json={"newPassword": "short"},
        headers=auth_header(admin),
    )

    assert response.status_code == 400


def test_admin_reset_password_changes_nothing_else(seeded_app, client, session, auth_header):
    admin = make_user(session, role=UserRole.ADMIN, email="onlypw@kartavya.gov")
    zone = session.query(Zone).first()
    officer = make_user(
        session, role=UserRole.OFFICER, email="onlypw@kartavya.gov.in", zone_id=zone.id
    )

    client.post(
        f"{API}/admin/users/{officer.id}/reset-password",
        json={"newPassword": "another-new-password"},
        headers=auth_header(admin),
    )

    session.refresh(officer)
    assert officer.role is UserRole.OFFICER
    assert officer.zone_id == zone.id
    assert officer.is_active is True


def test_admin_reset_password_404s_for_an_unknown_user(seeded_app, client, session, auth_header):
    admin = make_user(session, role=UserRole.ADMIN, email="nouser@kartavya.gov")

    response = client.post(
        f"{API}/admin/users/999999/reset-password",
        json={"newPassword": "brand-new-password"},
        headers=auth_header(admin),
    )

    assert response.status_code == 404


@pytest.mark.parametrize("role", [UserRole.CITIZEN, UserRole.OFFICER])
def test_reset_password_is_admin_only(seeded_app, client, session, auth_header, role):
    zone = session.query(Zone).first()
    caller = make_user(
        session,
        role=role,
        email=f"notadmin.{role.value.lower()}@example.com",
        zone_id=zone.id if role is UserRole.OFFICER else None,
    )
    victim = make_user(session, role=UserRole.CITIZEN, email=f"victim.{role.value}@example.com")

    response = client.post(
        f"{API}/admin/users/{victim.id}/reset-password",
        json={"newPassword": "brand-new-password"},
        headers=auth_header(caller),
    )

    assert response.status_code == 403
