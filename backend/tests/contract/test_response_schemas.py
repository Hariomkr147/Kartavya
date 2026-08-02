"""Every response shape, checked against `backend/api/openapi.yaml` itself.

This is the layer architecture.md Part 14 calls for and the repository did not
have. It walks one realistic complaint from filing to close, validating each
response against the component schema the contract names for that operation.

Two kinds of assertion, and the second is the one that earns its keep:

  * `assert_matches_schema` — the payload satisfies the schema. Catches a wrong
    type, a missing required field, an out-of-range enum.
  * `assert_no_undeclared_keys` — the payload invents nothing. jsonschema is
    permissive about extra properties by default, so a field named after its
    database column (`pointsChange` where the contract says `amount`) validates
    happily while breaking every client. That failure mode is exactly what
    shipped, so it gets its own explicit check.
"""

from __future__ import annotations

import io

import pytest

from app.core.auth import issue_token
from app.domain.enums import UserRole
from app.models import ComplaintCategory, User, Zone
from app.services.accounts.auth import hash_password

API = "/api/v1"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 256


def photo():
    return (io.BytesIO(PNG), "evidence.png")


def auth(user):
    token, _expires = issue_token(user)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def world(seeded_app, session):
    """A zone with one citizen, one officer, and the seeded admin."""
    zone = session.query(Zone).filter_by(is_catch_all=True).one()
    category = session.query(ComplaintCategory).order_by(ComplaintCategory.id).first()
    admin = session.query(User).filter_by(role=UserRole.ADMIN).first()
    officer = User(
        full_name="Officer Rao",
        email="officer@contract.example.com",
        password_hash=hash_password("password123"),
        role=UserRole.OFFICER,
        zone_id=zone.id,
    )
    citizen = User(
        full_name="Asha Verma",
        email="citizen@contract.example.com",
        password_hash=hash_password("password123"),
        role=UserRole.CITIZEN,
        zone_id=zone.id,
    )
    session.add_all([officer, citizen])
    session.commit()
    return {
        "zone": zone,
        "category": category,
        "admin": admin,
        "officer": officer,
        "citizen": citizen,
    }


@pytest.fixture
def assert_no_undeclared_keys(schema_properties):
    """Fail on any response key the contract does not declare."""

    def _assert(payload: dict, schema_name: str, *, where: str) -> None:
        undeclared = set(payload) - schema_properties(schema_name)
        assert not undeclared, (
            f"{where} returned key(s) {sorted(undeclared)} that openapi.yaml's "
            f"{schema_name} does not declare"
        )

    return _assert


@pytest.fixture
def filed_complaint(client, world):
    """A complaint filed through the real endpoint, returned as (id, payload)."""
    response = client.post(
        f"{API}/complaints",
        headers=auth(world["citizen"]),
        data={
            "categoryId": str(world["category"].id),
            "zoneId": str(world["zone"].id),
            "latitude": "12.9716",
            "longitude": "77.5946",
            "description": "Deep pothole outside the school gate.",
            "photos": photo(),
        },
        content_type="multipart/form-data",
    )
    assert response.status_code == 201
    return response.get_json()["id"], response.get_json()


# --- Auth and reference --------------------------------------------------------


def test_auth_response(seeded_app, client, world, assert_matches_schema):
    response = client.post(
        f"{API}/auth/login",
        json={"email": "citizen@contract.example.com", "password": "password123"},
    )
    assert response.status_code == 200
    assert_matches_schema(response.get_json(), "AuthResponse")


def test_user_and_category_and_zone(
    seeded_app, client, world, assert_matches_schema, assert_no_undeclared_keys
):
    me = client.get(f"{API}/users/me", headers=auth(world["citizen"])).get_json()
    assert_matches_schema(me, "User")
    assert_no_undeclared_keys(me, "User", where="GET /users/me")

    categories = client.get(f"{API}/categories").get_json()
    for item in categories:
        assert_matches_schema(item, "Category")
        assert_no_undeclared_keys(item, "Category", where="GET /categories")

    zones = client.get(f"{API}/zones").get_json()
    for item in zones:
        assert_matches_schema(item, "Zone")
        assert_no_undeclared_keys(item, "Zone", where="GET /zones")


def test_zone_suggestion(seeded_app, client, world, assert_matches_schema):
    response = client.post(
        f"{API}/zones/suggest",
        headers=auth(world["citizen"]),
        json={"latitude": 12.9716, "longitude": 77.5946},
    )
    assert_matches_schema(response.get_json(), "ZoneSuggestionResponse")


# --- Complaints ----------------------------------------------------------------


def test_complaint_detail_on_create(
    seeded_app, filed_complaint, assert_matches_schema, assert_no_undeclared_keys
):
    _id, payload = filed_complaint
    assert_matches_schema(payload, "ComplaintDetail")
    assert_no_undeclared_keys(payload, "ComplaintDetail", where="POST /complaints")


def test_complaint_list_and_feed(
    seeded_app, client, world, filed_complaint, assert_matches_schema, assert_no_undeclared_keys
):
    headers = auth(world["citizen"])

    listing = client.get(f"{API}/complaints/my", headers=headers).get_json()
    assert_matches_schema(listing, "ComplaintListResponse")
    assert_no_undeclared_keys(
        listing["pagination"], "PaginationMeta", where="GET /complaints/my pagination"
    )

    feed = client.get(f"{API}/feed", headers=headers).get_json()
    assert_matches_schema(feed, "FeedListResponse")
    assert_no_undeclared_keys(feed["pagination"], "PaginationMeta", where="GET /feed pagination")
    for item in feed["data"]:
        assert_no_undeclared_keys(item, "FeedItem", where="GET /feed item")


def test_upvote_result(seeded_app, client, session, world, filed_complaint, assert_matches_schema):
    complaint_id, _payload = filed_complaint
    neighbour = User(
        full_name="Neighbour",
        email="neighbour@contract.example.com",
        password_hash=hash_password("password123"),
        role=UserRole.CITIZEN,
        zone_id=world["zone"].id,
    )
    session.add(neighbour)
    session.commit()

    response = client.post(
        f"{API}/complaints/{complaint_id}/upvote", headers=auth(neighbour)
    )
    assert response.status_code == 200
    assert_matches_schema(response.get_json(), "UpvoteResult")


# --- Officer -------------------------------------------------------------------


def test_officer_queue_and_actions(
    seeded_app, client, world, filed_complaint, assert_matches_schema, assert_no_undeclared_keys
):
    complaint_id, _payload = filed_complaint
    headers = auth(world["officer"])

    queue = client.get(f"{API}/officer/complaints", headers=headers).get_json()
    assert_matches_schema(queue, "ComplaintListResponse")
    assert_no_undeclared_keys(
        queue["pagination"], "PaginationMeta", where="GET /officer/complaints pagination"
    )

    claimed = client.post(f"{API}/officer/complaints/{complaint_id}/claim", headers=headers)
    assert_matches_schema(claimed.get_json(), "ComplaintDetail")

    reviewed = client.post(
        f"{API}/officer/complaints/{complaint_id}/evidence-review",
        headers=headers,
        json={"verdict": "VALID"},
    )
    assert_matches_schema(reviewed.get_json(), "ComplaintDetail")
    for evidence in reviewed.get_json()["evidence"]:
        assert_matches_schema(evidence, "Evidence")
        assert_no_undeclared_keys(evidence, "Evidence", where="ComplaintDetail.evidence")

    updated = client.patch(
        f"{API}/officer/complaints/{complaint_id}/status",
        headers=headers,
        json={"status": "IN_PROGRESS"},
    )
    assert_matches_schema(updated.get_json(), "StatusUpdateResult")

    note = client.post(
        f"{API}/officer/complaints/{complaint_id}/notes",
        headers=headers,
        json={"text": "Crew scheduled for tomorrow."},
    )
    assert note.status_code == 201
    assert_matches_schema(note.get_json(), "ProgressNote")
    assert_no_undeclared_keys(note.get_json(), "ProgressNote", where="POST .../notes")


def test_batch_status_result(seeded_app, client, world, filed_complaint, assert_matches_schema):
    complaint_id, _payload = filed_complaint
    response = client.post(
        f"{API}/officer/complaints/batch-status",
        headers=auth(world["officer"]),
        json={"complaintIds": [str(complaint_id)], "status": "IN_PROGRESS"},
    )
    assert response.status_code == 200
    assert_matches_schema(response.get_json(), "BatchStatusUpdateResult")


def test_officer_analytics_and_public_stats(
    seeded_app, client, world, assert_matches_schema, assert_no_undeclared_keys
):
    analytics = client.get(f"{API}/officer/analytics", headers=auth(world["officer"])).get_json()
    assert_matches_schema(analytics, "ZoneAnalytics")
    assert_no_undeclared_keys(analytics, "ZoneAnalytics", where="GET /officer/analytics")

    stats = client.get(
        f"{API}/officers/{world['officer'].id}/stats", headers=auth(world["citizen"])
    ).get_json()
    assert_matches_schema(stats, "PublicOfficerStats")
    assert_no_undeclared_keys(stats, "PublicOfficerStats", where="GET /officers/{id}/stats")


# --- Shared: clusters and zone summary -----------------------------------------


def test_clusters_and_zone_summary(
    seeded_app, client, world, filed_complaint, assert_matches_schema, assert_no_undeclared_keys
):
    headers = auth(world["officer"])

    clusters = client.get(f"{API}/clusters", headers=headers).get_json()
    assert_matches_schema(clusters, "ClusterListResponse")
    assert_no_undeclared_keys(
        clusters["pagination"], "PaginationMeta", where="GET /clusters pagination"
    )

    summary = client.get(f"{API}/zones/{world['zone'].id}/summary", headers=headers).get_json()
    assert_matches_schema(summary, "ZoneSummary")
    assert_no_undeclared_keys(summary, "ZoneSummary", where="GET /zones/{id}/summary")
    # Declared by the contract and previously absent altogether.
    assert {"totalClusters", "activeClusters"} <= set(summary)


# --- Gamification --------------------------------------------------------------


def test_points_and_badges_and_leaderboard(
    seeded_app, client, world, filed_complaint, assert_matches_schema, assert_no_undeclared_keys
):
    headers = auth(world["citizen"])

    points = client.get(f"{API}/gamification/points", headers=headers).get_json()
    assert_matches_schema(points, "PointsSummary")
    assert points["ledger"], "filing a first complaint should credit FIRST_COMPLAINT"
    for entry in points["ledger"]:
        assert_matches_schema(entry, "PointsLedgerEntry")
        assert_no_undeclared_keys(
            entry, "PointsLedgerEntry", where="GET /gamification/points ledger"
        )

    badges = client.get(f"{API}/gamification/badges", headers=headers).get_json()
    for badge in badges:
        assert_matches_schema(badge, "Badge")
        assert_no_undeclared_keys(badge, "Badge", where="GET /gamification/badges")

    board = client.get(f"{API}/leaderboard?scope=zone", headers=headers).get_json()
    assert_matches_schema(board, "LeaderboardResponse")
    for entry in board["data"]:
        assert_no_undeclared_keys(entry, "LeaderboardEntry", where="GET /leaderboard entry")


# --- Admin ---------------------------------------------------------------------


def test_admin_surfaces(
    seeded_app, client, world, filed_complaint, assert_matches_schema, assert_no_undeclared_keys
):
    headers = auth(world["admin"])

    complaints = client.get(f"{API}/admin/complaints", headers=headers).get_json()
    assert_matches_schema(complaints, "ComplaintListResponse")

    users = client.get(f"{API}/admin/users", headers=headers).get_json()
    assert_matches_schema(users, "UserListResponse")
    for user in users["data"]:
        assert_no_undeclared_keys(user, "User", where="GET /admin/users")

    settings = client.get(f"{API}/admin/settings", headers=headers).get_json()
    assert_matches_schema(settings, "Settings")
    assert_no_undeclared_keys(settings, "Settings", where="GET /admin/settings")

    analytics = client.get(f"{API}/admin/analytics", headers=headers).get_json()
    assert_matches_schema(analytics, "SystemAnalytics")
    for zone_block in analytics["zones"]:
        assert_no_undeclared_keys(zone_block, "ZoneMetrics", where="SystemAnalytics.zones")

    performance = client.get(
        f"{API}/admin/officers/{world['officer'].id}/performance", headers=headers
    ).get_json()
    assert_matches_schema(performance, "OfficerPerformance")
    assert_no_undeclared_keys(
        performance, "OfficerPerformance", where="GET /admin/officers/{id}/performance"
    )


def test_admin_complaint_detail_carries_reporter(
    seeded_app, client, world, filed_complaint, assert_matches_schema
):
    complaint_id, _payload = filed_complaint
    detail = client.get(
        f"{API}/complaints/{complaint_id}", headers=auth(world["admin"])
    ).get_json()
    assert_matches_schema(detail, "ComplaintDetail")
    assert detail["reporter"]["id"] == str(world["citizen"].id)


def test_ai_zone_report(
    seeded_app, client, world, assert_matches_schema, assert_no_undeclared_keys
):
    headers = auth(world["admin"])
    created = client.post(f"{API}/admin/zones/{world['zone'].id}/ai-report", headers=headers)
    assert created.status_code == 202
    assert_matches_schema(created.get_json(), "AiZoneReport")

    fetched = client.get(f"{API}/admin/zones/{world['zone'].id}/ai-report", headers=headers)
    assert fetched.status_code == 200
    assert_matches_schema(fetched.get_json(), "AiZoneReport")
    assert_no_undeclared_keys(
        fetched.get_json(), "AiZoneReport", where="GET /admin/zones/{id}/ai-report"
    )


# --- Errors --------------------------------------------------------------------


def test_error_envelope(seeded_app, client, world, assert_matches_schema):
    unauthorized = client.get(f"{API}/officer/complaints")
    assert unauthorized.status_code == 401
    assert_matches_schema(unauthorized.get_json(), "Error")

    forbidden = client.get(f"{API}/officer/complaints", headers=auth(world["citizen"]))
    assert forbidden.status_code == 403
    assert_matches_schema(forbidden.get_json(), "Error")

    not_found = client.get(f"{API}/complaints/999999", headers=auth(world["citizen"]))
    assert not_found.status_code == 404
    assert_matches_schema(not_found.get_json(), "Error")
