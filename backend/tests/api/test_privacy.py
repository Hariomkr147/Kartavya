import pytest
from unittest import mock
from app.settings import API_PREFIX
import app.core.auth

IDENTITY_KEYS = {"reporter", "fullName", "full_name", "citizenId", "email"}

def assert_no_identity(payload) -> None:
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

@pytest.fixture
def auth_header_mock():
    return {"Authorization": "Bearer fake"}

@pytest.fixture(autouse=True)
def mock_load_user():
    from app.models import User
    from app.domain.enums import UserRole
    with mock.patch("app.core.auth.load_current_user") as mock_load:
        def side_effect():
            from flask import g
            user = User(id=1, zone_id=1, role=UserRole.OFFICER)
            g.current_user = user
            return user
        mock_load.side_effect = side_effect
        yield mock_load

@pytest.mark.skip(reason="TODO(phase 4): enable once the officer queue is implemented")
def test_officer_queue_never_exposes_the_reporter(client, auth_header_mock):
    response = client.get(f"{API_PREFIX}/officer/complaints", headers=auth_header_mock)
    assert_no_identity(response.get_json())

@pytest.mark.skip(reason="TODO(phase 4): enable once complaint detail is implemented")
def test_officer_complaint_detail_never_exposes_the_reporter(client, auth_header_mock):
    response = client.get(f"{API_PREFIX}/complaints/1", headers=auth_header_mock)
    assert_no_identity(response.get_json())

@pytest.mark.skip(reason="TODO(phase 3): enable once the feed is implemented")
def test_public_feed_never_exposes_the_reporter(client, auth_header_mock):
    response = client.get(f"{API_PREFIX}/feed", headers=auth_header_mock)
    assert_no_identity(response.get_json())

@pytest.mark.skip(reason="TODO(phase 5): enable once cluster detail is implemented")
def test_cluster_detail_never_exposes_a_reporter(client, auth_header_mock):
    response = client.get(f"{API_PREFIX}/clusters/1", headers=auth_header_mock)
    assert_no_identity(response.get_json())

@pytest.mark.skip(reason="TODO(phase 6): enable once the leaderboard is implemented")
def test_leaderboard_uses_display_names_never_full_names(client, auth_header_mock):
    response = client.get(f"{API_PREFIX}/leaderboard", headers=auth_header_mock)
    assert_no_identity(response.get_json())

@pytest.mark.skip(reason="TODO(phase 4): enable once officer stats are implemented")
def test_public_officer_stats_carry_no_name(client, auth_header_mock):
    response = client.get(f"{API_PREFIX}/officers/1/stats", headers=auth_header_mock)
    assert_no_identity(response.get_json())

@pytest.mark.skip(reason="TODO(phase 4): enable once zone scoping is implemented")
def test_officer_cannot_read_another_zone(client, auth_header_mock):
    response = client.get(f"{API_PREFIX}/complaints/99", headers=auth_header_mock)
    assert response.status_code == 403
