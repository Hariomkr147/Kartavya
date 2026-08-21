"""Privacy assertions for every role-visible endpoint."""

from __future__ import annotations

import pytest

from app.settings import API_PREFIX

IDENTITY_KEYS = {"reporter", "fullName", "full_name", "citizenId", "email"}


def assert_no_identity(payload) -> None:
    """Recursively assert that reporter identity is structurally absent."""
    if isinstance(payload, dict):
        leaked = IDENTITY_KEYS & set(payload)
        assert not leaked, f"identity fields leaked: {sorted(leaked)}"
        for value in payload.values():
            assert_no_identity(value)
    elif isinstance(payload, list):
        for item in payload:
            assert_no_identity(item)


def test_the_helper_catches_a_nested_leak():
    with pytest.raises(AssertionError):
        assert_no_identity({"items": [{"complaint": {"reporter": {"id": "1"}}}]})
    assert_no_identity({"items": [{"complaint": {"id": "1", "status": "SUBMITTED"}}]})


@pytest.mark.skip(reason="TODO(phase 4): enable once the officer queue is implemented")
def test_officer_queue_never_exposes_the_reporter(client, auth_header, officer_user):
    response = client.get(f"{API_PREFIX}/officer/complaints", headers=auth_header(officer_user))
    assert_no_identity(response.get_json())


@pytest.mark.skip(reason="TODO(phase 4): enable once complaint detail is implemented")
def test_officer_complaint_detail_never_exposes_the_reporter(
    client, auth_header, officer_user, complaint_in_officer_zone
):
    response = client.get(
        f"{API_PREFIX}/complaints/{complaint_in_officer_zone.id}",
        headers=auth_header(officer_user),
    )
    assert_no_identity(response.get_json())


@pytest.mark.skip(reason="TODO(phase 3): enable once the feed is implemented")
def test_public_feed_never_exposes_the_reporter(client, auth_header, citizen_user):
    response = client.get(f"{API_PREFIX}/feed", headers=auth_header(citizen_user))
    assert_no_identity(response.get_json())


@pytest.mark.skip(reason="TODO(phase 5): enable once cluster detail is implemented")
def test_cluster_detail_never_exposes_a_reporter(client, auth_header, officer_user, cluster):
    response = client.get(f"{API_PREFIX}/clusters/{cluster.id}", headers=auth_header(officer_user))
    assert_no_identity(response.get_json())


@pytest.mark.skip(reason="TODO(phase 6): enable once the leaderboard is implemented")
def test_leaderboard_uses_display_names_never_full_names(client, auth_header, citizen_user):
    response = client.get(f"{API_PREFIX}/leaderboard", headers=auth_header(citizen_user))
    assert_no_identity(response.get_json())


@pytest.mark.skip(reason="TODO(phase 4): enable once officer stats are implemented")
def test_public_officer_stats_carry_no_name(client, auth_header, citizen_user, officer_user):
    response = client.get(
        f"{API_PREFIX}/officers/{officer_user.id}/stats", headers=auth_header(citizen_user)
    )
    assert_no_identity(response.get_json())


@pytest.mark.skip(reason="TODO(phase 4): enable once zone scoping is implemented")
def test_officer_cannot_read_another_zone(
    client, auth_header, officer_user, complaint_in_other_zone
):
    response = client.get(
        f"{API_PREFIX}/complaints/{complaint_in_other_zone.id}",
        headers=auth_header(officer_user),
    )
    assert response.status_code == 403


def test_current_user_is_not_cached_across_requests(seeded_app, session, auth_header):
    from sqlalchemy import select

    from app.core.auth import load_current_user
    from app.domain.enums import UserRole
    from app.extensions import db
    from app.models import User, Zone
    from app.services.accounts.auth import hash_password

    zone = session.execute(select(Zone).where(Zone.is_catch_all.is_(True))).scalar_one()
    users = []
    for name in ("first", "second"):
        user = User(
            full_name=name.title(),
            display_name=None,
            email=f"{name}@example.com",
            password_hash=hash_password("password123"),
            role=UserRole.CITIZEN,
            zone_id=zone.id,
            is_active=True,
        )
        db.session.add(user)
        users.append(user)
    session.commit()

    seen = []
    for user in users:
        with seeded_app.test_request_context(headers=auth_header(user)):
            seen.append(load_current_user().id)

    assert seen == [users[0].id, users[1].id]
