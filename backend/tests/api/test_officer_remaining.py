from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest import mock

import pytest

from app.domain.enums import ComplaintStatus, StatusActor, UserRole
from app.models import (
    Complaint,
    ComplaintCategory,
    ComplaintCluster,
    ComplaintNote,
    StatusHistory,
    User,
    Zone,
)


@pytest.fixture
def officer_data(seeded_app, session):
    category = session.query(ComplaintCategory).first()
    zone = Zone(
        zone_code="TEST-OFFICER",
        zone_name="Officer Zone",
        center_lat=1,
        center_lng=1,
        is_active=True,
        is_catch_all=False,
    )
    other_zone = Zone(
        zone_code="TEST-OTHER",
        zone_name="Other Zone",
        center_lat=2,
        center_lng=2,
        is_active=True,
        is_catch_all=False,
    )
    session.add_all([zone, other_zone])
    session.flush()
    officer = User(
        full_name="Officer",
        email="officer@example.test",
        password_hash="unused",
        role=UserRole.OFFICER,
        zone_id=zone.id,
        is_active=True,
    )
    citizen = User(
        full_name="Citizen",
        email="citizen@example.test",
        password_hash="unused",
        role=UserRole.CITIZEN,
        zone_id=zone.id,
        is_active=True,
    )
    session.add_all([officer, citizen])
    session.flush()

    serial = 0

    def complaint(status, *, selected_zone=zone, cluster=None, created_at=None, **values):
        nonlocal serial
        serial += 1
        values.setdefault("sla_paused_seconds", 0)
        row = Complaint(
            complaint_code=f"TEST-{serial}",
            citizen_id=citizen.id,
            zone_id=selected_zone.id,
            category_id=category.id,
            cluster_id=cluster.id if cluster else None,
            latitude=1,
            longitude=1,
            status=status,
            severity_score=0,
            created_at=created_at or datetime.now(UTC).replace(tzinfo=None),
            **values,
        )
        session.add(row)
        session.flush()
        return row

    return {
        "category": category,
        "zone": zone,
        "other_zone": other_zone,
        "officer": officer,
        "citizen": citizen,
        "complaint": complaint,
    }


def test_batch_reports_mixed_results_and_audits_only_success(
    seeded_app, session, auth_header, officer_data
):
    make = officer_data["complaint"]
    valid = make(ComplaintStatus.IN_PROGRESS)
    invalid = make(ComplaintStatus.SUBMITTED)
    outside = make(ComplaintStatus.IN_PROGRESS, selected_zone=officer_data["other_zone"])
    session.commit()

    response = seeded_app.test_client().post(
        "/api/v1/officer/complaints/batch-status",
        json={
            "complaintIds": [str(valid.id), str(invalid.id), "999999", str(outside.id)],
            "status": "UNDER_RESOLUTION",
            "note": "  inspected  ",
        },
        headers=auth_header(officer_data["officer"]),
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body["summary"] == {"requested": 4, "succeeded": 1, "failed": 3}
    assert [item["errorCode"] for item in body["results"]] == [
        None,
        "INVALID_TRANSITION",
        "UNKNOWN_COMPLAINT",
        "NOT_IN_ZONE",
    ]
    session.expire_all()
    assert session.get(Complaint, valid.id).status == ComplaintStatus.UNDER_RESOLUTION
    assert session.get(Complaint, invalid.id).status == ComplaintStatus.SUBMITTED
    histories = session.query(StatusHistory).filter_by(complaint_id=valid.id).all()
    assert len(histories) == 1
    assert histories[0].actor_role == StatusActor.OFFICER
    assert histories[0].remark == "inspected"


@pytest.mark.parametrize(
    "payload",
    [
        {"status": "IN_PROGRESS"},
        {"complaintIds": ["1"], "clusterId": "1", "status": "IN_PROGRESS"},
        {"complaintIds": None, "clusterId": "1", "status": "IN_PROGRESS"},
        {"complaintIds": ["1"], "clusterId": None, "status": "IN_PROGRESS"},
        {"complaintIds": [], "status": "IN_PROGRESS"},
        {"complaintIds": [str(index) for index in range(1, 102)], "status": "IN_PROGRESS"},
        {"complaintIds": [True], "status": "IN_PROGRESS"},
        {"complaintIds": [1.0], "status": "IN_PROGRESS"},
        {"complaintIds": ["1.0"], "status": "IN_PROGRESS"},
        {"complaintIds": ["0"], "status": "IN_PROGRESS"},
        {"complaintIds": ["-1"], "status": "IN_PROGRESS"},
        {"complaintIds": ["9223372036854775808"], "status": "IN_PROGRESS"},
        {"complaintIds": ["1"], "status": "CLOSED"},
        {"complaintIds": ["1"], "status": "IN_PROGRESS", "unexpected": True},
    ],
)
def test_batch_rejects_invalid_request_shapes(seeded_app, auth_header, officer_data, payload):
    response = seeded_app.test_client().post(
        "/api/v1/officer/complaints/batch-status",
        json=payload,
        headers=auth_header(officer_data["officer"]),
    )
    assert response.status_code == 400


def test_batch_requires_a_json_object_body(seeded_app, auth_header, officer_data):
    client = seeded_app.test_client()
    headers = auth_header(officer_data["officer"])
    assert (
        client.post("/api/v1/officer/complaints/batch-status", headers=headers).status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/officer/complaints/batch-status", json=[], headers=headers
        ).status_code
        == 400
    )


def test_batch_reason_failure_is_per_item_and_resolved_does_not_cascade(
    seeded_app, session, auth_header, officer_data
):
    make = officer_data["complaint"]
    cluster = ComplaintCluster(
        category_id=officer_data["category"].id,
        zone_id=officer_data["zone"].id,
        centroid_lat=1,
        centroid_lng=1,
        report_count=2,
        unique_reporter_count=1,
    )
    session.add(cluster)
    session.flush()
    selected = make(ComplaintStatus.UNDER_REVIEW, cluster=cluster)
    sibling = make(ComplaintStatus.UNDER_RESOLUTION, cluster=cluster)
    session.commit()
    client = seeded_app.test_client()
    headers = auth_header(officer_data["officer"])

    missing_reason = client.post(
        "/api/v1/officer/complaints/batch-status",
        json={"complaintIds": [str(selected.id)], "status": "UNRESOLVABLE"},
        headers=headers,
    )
    assert missing_reason.status_code == 200
    assert missing_reason.get_json()["results"][0]["errorCode"] == "REASON_REQUIRED"

    resolved = client.post(
        "/api/v1/officer/complaints/batch-status",
        json={"complaintIds": [str(sibling.id)], "status": "RESOLVED"},
        headers=headers,
    )
    assert resolved.status_code == 200
    session.expire_all()
    assert session.get(Complaint, sibling.id).status == ComplaintStatus.RESOLVED
    assert session.get(Complaint, sibling.id).resolved_at is not None
    assert session.get(Complaint, selected.id).status == ComplaintStatus.UNDER_REVIEW


def test_cluster_batch_unknown_is_404_and_member_zone_is_checked(
    seeded_app, session, auth_header, officer_data
):
    cluster = ComplaintCluster(
        category_id=officer_data["category"].id,
        zone_id=officer_data["zone"].id,
        centroid_lat=1,
        centroid_lng=1,
        report_count=2,
        unique_reporter_count=1,
    )
    session.add(cluster)
    session.flush()
    inside = officer_data["complaint"](ComplaintStatus.IN_PROGRESS, cluster=cluster)
    outside = officer_data["complaint"](
        ComplaintStatus.IN_PROGRESS, cluster=cluster, selected_zone=officer_data["other_zone"]
    )
    session.commit()
    client = seeded_app.test_client()
    headers = auth_header(officer_data["officer"])

    assert (
        client.post(
            "/api/v1/officer/complaints/batch-status",
            json={"clusterId": "999999", "status": "UNDER_RESOLUTION"},
            headers=headers,
        ).status_code
        == 404
    )
    response = client.post(
        "/api/v1/officer/complaints/batch-status",
        json={"clusterId": str(cluster.id), "status": "UNDER_RESOLUTION"},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.get_json()["summary"] == {"requested": 2, "succeeded": 1, "failed": 1}
    assert {item["complaintId"]: item["errorCode"] for item in response.get_json()["results"]} == {
        str(inside.id): None,
        str(outside.id): "NOT_IN_ZONE",
    }

    inaccessible = ComplaintCluster(
        category_id=officer_data["category"].id,
        zone_id=officer_data["other_zone"].id,
        centroid_lat=2,
        centroid_lng=2,
        report_count=0,
        unique_reporter_count=0,
    )
    session.add(inaccessible)
    session.commit()
    assert (
        client.post(
            "/api/v1/officer/complaints/batch-status",
            json={"clusterId": str(inaccessible.id), "status": "UNDER_RESOLUTION"},
            headers=headers,
        ).status_code
        == 403
    )


def test_batch_handles_duplicate_ids_and_empty_cluster(
    seeded_app, session, auth_header, officer_data
):
    row = officer_data["complaint"](ComplaintStatus.IN_PROGRESS)
    empty_cluster = ComplaintCluster(
        category_id=officer_data["category"].id,
        zone_id=officer_data["zone"].id,
        centroid_lat=1,
        centroid_lng=1,
        report_count=0,
        unique_reporter_count=0,
    )
    session.add(empty_cluster)
    session.commit()
    client = seeded_app.test_client()
    headers = auth_header(officer_data["officer"])

    duplicate = client.post(
        "/api/v1/officer/complaints/batch-status",
        json={"complaintIds": [str(row.id), str(row.id)], "status": "UNDER_RESOLUTION"},
        headers=headers,
    )
    assert duplicate.status_code == 200
    assert duplicate.get_json()["summary"] == {"requested": 2, "succeeded": 1, "failed": 1}
    assert [item["errorCode"] for item in duplicate.get_json()["results"]] == [
        None,
        "INVALID_TRANSITION",
    ]
    assert session.query(StatusHistory).filter_by(complaint_id=row.id).count() == 1

    empty = client.post(
        "/api/v1/officer/complaints/batch-status",
        json={"clusterId": str(empty_cluster.id), "status": "UNDER_RESOLUTION"},
        headers=headers,
    )
    assert empty.status_code == 200
    assert empty.get_json() == {
        "results": [],
        "summary": {"requested": 0, "succeeded": 0, "failed": 0},
    }


def test_batch_needs_more_evidence_pauses_sla_and_records_reason(
    seeded_app, session, auth_header, officer_data
):
    started_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=2)
    row = officer_data["complaint"](
        ComplaintStatus.UNDER_REVIEW,
        sla_target_hours=24,
        sla_started_at=started_at,
    )
    session.commit()
    response = seeded_app.test_client().post(
        "/api/v1/officer/complaints/batch-status",
        json={
            "complaintIds": [str(row.id)],
            "status": "NEEDS_MORE_EVIDENCE",
            "reason": "  clearer photo needed  ",
        },
        headers=auth_header(officer_data["officer"]),
    )
    assert response.status_code == 200
    session.expire_all()
    updated = session.get(Complaint, row.id)
    assert updated.status == ComplaintStatus.NEEDS_MORE_EVIDENCE
    assert updated.sla_paused_at is not None
    history = session.query(StatusHistory).filter_by(complaint_id=row.id).one()
    assert history.reason == "clearer photo needed"


def test_single_and_cluster_notes_trim_and_only_write_eligible_members(
    seeded_app, session, auth_header, officer_data
):
    cluster = ComplaintCluster(
        category_id=officer_data["category"].id,
        zone_id=officer_data["zone"].id,
        centroid_lat=1,
        centroid_lng=1,
        report_count=3,
        unique_reporter_count=1,
    )
    session.add(cluster)
    session.flush()
    first = officer_data["complaint"](ComplaintStatus.IN_PROGRESS, cluster=cluster)
    officer_data["complaint"](ComplaintStatus.UNDER_RESOLUTION, cluster=cluster)
    moved_zone = officer_data["complaint"](
        ComplaintStatus.IN_PROGRESS,
        cluster=cluster,
        selected_zone=officer_data["other_zone"],
    )
    skipped = officer_data["complaint"](ComplaintStatus.SUBMITTED, cluster=cluster)
    session.commit()
    client = seeded_app.test_client()
    headers = auth_header(officer_data["officer"])

    single = client.post(
        f"/api/v1/officer/complaints/{first.id}/notes",
        json={"text": "  first update  "},
        headers=headers,
    )
    assert single.status_code == 201
    assert single.get_json()["text"] == "first update"
    cluster_response = client.post(
        f"/api/v1/officer/clusters/{cluster.id}/notes",
        json={"text": "  shared update  "},
        headers=headers,
    )
    assert cluster_response.status_code == 201
    assert len(cluster_response.get_json()) == 3
    assert {item["text"] for item in cluster_response.get_json()} == {"shared update"}
    assert session.query(ComplaintNote).filter_by(complaint_id=moved_zone.id).count() == 1
    assert session.query(ComplaintNote).filter_by(complaint_id=skipped.id).count() == 0


def test_notes_validate_text_status_and_zone(seeded_app, session, auth_header, officer_data):
    wrong_status = officer_data["complaint"](ComplaintStatus.SUBMITTED)
    outside = officer_data["complaint"](
        ComplaintStatus.IN_PROGRESS, selected_zone=officer_data["other_zone"]
    )
    session.commit()
    client = seeded_app.test_client()
    headers = auth_header(officer_data["officer"])

    assert (
        client.post(
            f"/api/v1/officer/complaints/{wrong_status.id}/notes",
            json={"text": "update"},
            headers=headers,
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/v1/officer/complaints/{outside.id}/notes",
            json={"text": "update"},
            headers=headers,
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/v1/officer/complaints/999999/notes",
            json={"text": "update"},
            headers=headers,
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/v1/officer/complaints/{wrong_status.id}/notes",
            json={"text": "   "},
            headers=headers,
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/v1/officer/complaints/{wrong_status.id}/notes",
            json={"text": "x" * 501},
            headers=headers,
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/officer/clusters/999999/notes",
            json={"text": "update"},
            headers=headers,
        ).status_code
        == 404
    )


def test_notes_reject_invalid_bodies_and_accept_exact_boundary(
    seeded_app, session, auth_header, officer_data
):
    row = officer_data["complaint"](ComplaintStatus.IN_PROGRESS)
    session.commit()
    client = seeded_app.test_client()
    headers = auth_header(officer_data["officer"])
    path = f"/api/v1/officer/complaints/{row.id}/notes"

    assert client.post(path, headers=headers).status_code == 400
    assert (
        client.post(path, json={"text": "update", "extra": True}, headers=headers).status_code
        == 400
    )
    boundary = client.post(path, json={"text": "x" * 500}, headers=headers)
    assert boundary.status_code == 201
    assert boundary.get_json() == {
        "id": boundary.get_json()["id"],
        "officerId": str(officer_data["officer"].id),
        "text": "x" * 500,
        "createdAt": boundary.get_json()["createdAt"],
    }
    assert "name" not in boundary.get_json()


def test_cluster_notes_return_403_for_inaccessible_cluster(
    seeded_app, session, auth_header, officer_data
):
    cluster = ComplaintCluster(
        category_id=officer_data["category"].id,
        zone_id=officer_data["other_zone"].id,
        centroid_lat=2,
        centroid_lng=2,
        report_count=0,
        unique_reporter_count=0,
    )
    session.add(cluster)
    session.commit()
    response = seeded_app.test_client().post(
        f"/api/v1/officer/clusters/{cluster.id}/notes",
        json={"text": "update"},
        headers=auth_header(officer_data["officer"]),
    )
    assert response.status_code == 403


def test_cluster_notes_roll_back_when_flush_fails(
    seeded_app, session, auth_header, officer_data
):
    cluster = ComplaintCluster(
        category_id=officer_data["category"].id,
        zone_id=officer_data["zone"].id,
        centroid_lat=1,
        centroid_lng=1,
        report_count=1,
        unique_reporter_count=1,
    )
    session.add(cluster)
    session.flush()
    officer_data["complaint"](ComplaintStatus.IN_PROGRESS, cluster=cluster)
    session.commit()

    with mock.patch(
        "app.services.complaints.lifecycle.db.session.flush",
        side_effect=RuntimeError("simulated insert failure"),
    ):
        response = seeded_app.test_client().post(
            f"/api/v1/officer/clusters/{cluster.id}/notes",
            json={"text": "update"},
            headers=auth_header(officer_data["officer"]),
        )
    assert response.status_code == 500
    assert session.query(ComplaintNote).count() == 0


def test_cluster_notes_fail_when_none_eligible(seeded_app, session, auth_header, officer_data):
    cluster = ComplaintCluster(
        category_id=officer_data["category"].id,
        zone_id=officer_data["zone"].id,
        centroid_lat=1,
        centroid_lng=1,
        report_count=1,
        unique_reporter_count=1,
    )
    session.add(cluster)
    session.flush()
    officer_data["complaint"](ComplaintStatus.SUBMITTED, cluster=cluster)
    session.commit()
    response = seeded_app.test_client().post(
        f"/api/v1/officer/clusters/{cluster.id}/notes",
        json={"text": "update"},
        headers=auth_header(officer_data["officer"]),
    )
    assert response.status_code == 409
    assert session.query(ComplaintNote).count() == 0


def test_officer_analytics_scopes_filters_and_uses_sla_resolution_time(
    seeded_app, session, auth_header, officer_data
):
    now = datetime.now(UTC).replace(tzinfo=None)
    old = now - timedelta(days=60)
    recent = now - timedelta(days=2)
    make = officer_data["complaint"]
    make(
        ComplaintStatus.IN_PROGRESS,
        created_at=recent,
        sla_target_hours=1,
        sla_started_at=now - timedelta(hours=4),
    )
    make(ComplaintStatus.CLOSED, created_at=old)
    make(
        ComplaintStatus.RESOLVED,
        created_at=old,
        sla_started_at=now - timedelta(hours=12),
        resolved_at=now - timedelta(hours=2),
        sla_paused_seconds=7200,
    )
    make(
        ComplaintStatus.IN_PROGRESS,
        selected_zone=officer_data["other_zone"],
        created_at=recent,
        sla_target_hours=1,
        sla_started_at=now - timedelta(hours=10),
    )
    session.commit()

    response = seeded_app.test_client().get(
        "/api/v1/officer/analytics",
        query_string={"dateFrom": (now - timedelta(days=7)).isoformat()},
        headers=auth_header(officer_data["officer"]),
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body["zoneId"] == str(officer_data["zone"].id)
    assert body["activeComplaints"] == 1
    assert body["overdueCount"] == 1
    assert body["avgResolutionHoursThisMonth"] == pytest.approx(8.0)
    assert sum(item["count"] for item in body["categoryBreakdown"]) == 1


def test_officer_analytics_rejects_bad_range_and_unassigned_officer(
    seeded_app, session, auth_header, officer_data
):
    client = seeded_app.test_client()
    headers = auth_header(officer_data["officer"])
    empty = client.get("/api/v1/officer/analytics", headers=headers)
    assert empty.status_code == 200
    assert empty.get_json()["avgResolutionHoursThisMonth"] is None
    assert (
        client.get(
            "/api/v1/officer/analytics?dateFrom=2026-02-02T00:00:00Z&dateTo=2026-02-01T00:00:00Z",
            headers=headers,
        ).status_code
        == 400
    )
    for invalid in ("1", "2026-02-01", "not-a-date"):
        assert (
            client.get(
                "/api/v1/officer/analytics",
                query_string={"dateFrom": invalid},
                headers=headers,
            ).status_code
            == 400
        )

    officer_data["officer"].zone_id = None
    session.commit()
    assert (
        client.get(
            "/api/v1/officer/analytics",
            headers=headers,
        ).status_code
        == 403
    )


def test_officer_analytics_uses_current_zone_not_stale_jwt_claim(
    seeded_app, session, auth_header, officer_data
):
    old_zone_row = officer_data["complaint"](ComplaintStatus.IN_PROGRESS)
    new_zone_row = officer_data["complaint"](
        ComplaintStatus.IN_PROGRESS,
        selected_zone=officer_data["other_zone"],
    )
    session.commit()
    headers = auth_header(officer_data["officer"])
    officer_data["officer"].zone_id = officer_data["other_zone"].id
    session.commit()

    response = seeded_app.test_client().get("/api/v1/officer/analytics", headers=headers)
    assert response.status_code == 200
    assert response.get_json()["zoneId"] == str(officer_data["other_zone"].id)
    assert response.get_json()["activeComplaints"] == 1
    assert old_zone_row.id != new_zone_row.id


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        (
            "POST",
            "/api/v1/officer/complaints/batch-status",
            {"complaintIds": ["1"], "status": "IN_PROGRESS"},
        ),
        ("POST", "/api/v1/officer/complaints/1/notes", {"text": "update"}),
        ("POST", "/api/v1/officer/clusters/1/notes", {"text": "update"}),
        ("GET", "/api/v1/officer/analytics", None),
    ],
)
def test_remaining_officer_endpoints_require_officer_role(
    seeded_app, auth_header, officer_data, method, path, payload
):
    client = seeded_app.test_client()
    assert client.open(path, method=method, json=payload).status_code == 401
    assert (
        client.open(
            path,
            method=method,
            json=payload,
            headers=auth_header(officer_data["citizen"]),
        ).status_code
        == 403
    )
