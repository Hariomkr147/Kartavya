"""Privacy assertions — one per role-visible endpoint.

These are the cheapest high-value tests in the project and the reason `app/api/`
is split by audience at all. A leak here is the kind of bug that gets noticed by
the wrong person, so it gets asserted rather than reviewed by eye.

Fill these in as the endpoints land. They are skipped, not deleted — a skipped
test that names the rule is a reminder; a missing one is nothing.
"""

from __future__ import annotations

import pytest

from app.settings import API_PREFIX

IDENTITY_KEYS = {"reporter", "fullName", "full_name", "citizenId", "email"}


def assert_no_identity(payload) -> None:
    """Recursively assert no reporter identity anywhere in a response.

    Recursive on purpose: a leak is far more likely to appear nested inside
    `complaint.reporter` or a cluster's member list than at the top level.
    """
    if isinstance(payload, dict):
        leaked = IDENTITY_KEYS & set(payload)
        assert not leaked, f"identity fields leaked: {sorted(leaked)}"
        for value in payload.values():
            assert_no_identity(value)
    elif isinstance(payload, list):
        for item in payload:
            assert_no_identity(item)


def test_the_helper_catches_a_nested_leak():
    """Guards the guard — a privacy assertion that cannot fail is worthless."""
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
    response = client.get(
        f"{API_PREFIX}/clusters/{cluster.id}", headers=auth_header(officer_user)
    )
    assert_no_identity(response.get_json())


@pytest.mark.skip(reason="TODO(phase 6): enable once the leaderboard is implemented")
def test_leaderboard_uses_display_names_never_full_names(client, auth_header, citizen_user):
    """The masked fallback is "Citizen #1042" — never the real name."""
    response = client.get(f"{API_PREFIX}/leaderboard", headers=auth_header(citizen_user))
    assert_no_identity(response.get_json())


@pytest.mark.skip(reason="TODO(phase 4): enable once officer stats are implemented")
def test_public_officer_stats_carry_no_name(client, auth_header, citizen_user, officer_user):
    """Officers are identified to citizens by ID, never by name."""
    response = client.get(
        f"{API_PREFIX}/officers/{officer_user.id}/stats", headers=auth_header(citizen_user)
    )
    assert_no_identity(response.get_json())


@pytest.mark.skip(reason="TODO(phase 4): enable once zone scoping is implemented")
def test_officer_cannot_read_another_zone(
    client, auth_header, officer_user, complaint_in_other_zone
):
    """403, evaluated against the officer's CURRENT zone — not their token's."""
    response = client.get(
        f"{API_PREFIX}/complaints/{complaint_in_other_zone.id}",
        headers=auth_header(officer_user),
    )
    assert response.status_code == 403
