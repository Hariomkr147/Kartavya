"""Privacy, swept across the whole surface at once.

Every other file asserts privacy in passing. This one exists to fail loudly the
day a join, a serializer tweak, or a convenient `include_reporter=True` puts an
identity somewhere it has never been — so it walks the real endpoints with real
data and refuses identity anywhere but the admin's own views.
"""

from __future__ import annotations

import pytest

#: Keys that must never appear outside an admin's own views. `citizenId` is in
#: here because linking a complaint to an account is exactly the leak the whole
#: design exists to prevent — the leaderboard is the one contractual exception
#: (LeaderboardEntry.citizenId is required), and it passes `allow`.
IDENTITY_KEYS = {
    "reporter",
    "citizen",
    "citizenId",
    "citizenName",
    "reporterName",
    "email",
    "fullName",
    "full_name",
    "passwordHash",
    "password_hash",
}


def assert_no_identity(payload, *, where: str = "response", allow: frozenset = frozenset()) -> None:
    if isinstance(payload, dict):
        leaked = (IDENTITY_KEYS - allow) & set(payload)
        assert not leaked, f"{where}: identity keys {sorted(leaked)} leaked in {payload}"
        for key, value in payload.items():
            assert_no_identity(value, where=f"{where}.{key}", allow=allow)
    elif isinstance(payload, list):
        for index, item in enumerate(payload):
            assert_no_identity(item, where=f"{where}[{index}]", allow=allow)


def assert_no_personal_strings(text: str, *, where: str) -> None:
    for needle in ("Asha Verma", "asha@example.com", "North Officer", "officer.north@kartavya.gov"):
        assert needle not in text, f"{where}: '{needle}' appeared in the response body"


@pytest.fixture
def populated(platform, citizen, officer):
    """One cluster, one dispute, one closure, one upvote — a busy zone."""
    neighbour = platform.register_citizen("Bob Neighbour", email="bob@example.com")
    spot = platform.fresh_spot()

    clustered_a = platform.file_complaint(citizen, at=spot)
    clustered_b = platform.file_complaint(neighbour, at=platform.metres_north(spot, 6.0))
    solo = platform.file_complaint(citizen)

    neighbour.post(f"/complaints/{solo['id']}/upvote")
    platform.accept(clustered_a["id"])
    platform.drive_to(clustered_a["id"], "IN_PROGRESS")
    officer.post(
        f"/officer/complaints/{clustered_a['id']}/notes", expect=201, json={"text": "Crew out."}
    )

    return {
        "neighbour": neighbour,
        "cluster_id": platform.admin.get(f"/complaints/{clustered_a['id']}").get_json()[
            "clusterId"
        ],
        "clustered_a": clustered_a,
        "clustered_b": clustered_b,
        "solo": solo,
    }


def test_the_helper_catches_a_nested_leak():
    with pytest.raises(AssertionError):
        assert_no_identity({"data": [{"complaint": {"reporter": {"id": "7"}}}]})
    with pytest.raises(AssertionError):
        assert_no_personal_strings('{"name": "Asha Verma"}', where="probe")


def test_no_officer_facing_endpoint_carries_an_identity(platform, officer, populated):
    cluster_id = populated["cluster_id"]
    complaint_id = populated["clustered_a"]["id"]
    zone_id = platform.zone_id("north")

    for path in (
        "/officer/complaints",
        f"/complaints/{complaint_id}",
        "/clusters",
        f"/clusters/{cluster_id}",
        f"/zones/{zone_id}/summary",
        "/officer/analytics",
        f"/officers/{officer.id}/stats",
    ):
        response = officer.get(path)
        assert_no_identity(response.get_json(), where=path)
        assert_no_personal_strings(response.get_data(as_text=True), where=path)


def test_no_citizen_facing_endpoint_carries_another_persons_identity(platform, citizen, populated):
    for path in ("/feed", "/feed?includeResolved=true"):
        response = citizen.get(path)
        assert_no_identity(response.get_json(), where=path)
        assert_no_personal_strings(response.get_data(as_text=True), where=path)

    # The leaderboard is the single place a citizen id is contractual — it is a
    # public ranking. A name still must not appear beside it.
    board = citizen.get("/leaderboard?scope=zone&period=all_time")
    assert_no_identity(board.get_json(), where="/leaderboard", allow=frozenset({"citizenId"}))
    assert_no_personal_strings(board.get_data(as_text=True), where="/leaderboard")

    # A citizen's own complaint legitimately belongs to them, but even there the
    # reporter block is not echoed back — the citizen already knows who they are.
    own = citizen.complaint(populated["solo"]["id"])
    assert "reporter" not in own


def test_the_admin_is_the_only_role_that_sees_a_reporter(platform, admin, officer, populated):
    complaint_id = populated["solo"]["id"]

    admin_detail = admin.get(f"/complaints/{complaint_id}").get_json()
    assert admin_detail["reporter"]["name"] == "Asha Verma"

    assert "reporter" not in officer.complaint(complaint_id)
    # And even the admin's cross-zone LIST stays compact and identity-free.
    assert_no_identity(admin.get("/admin/complaints").get_json(), where="/admin/complaints")


def test_officers_are_known_to_citizens_by_id_and_never_by_name(
    platform, citizen, officer, populated
):
    detail = citizen.complaint(populated["clustered_a"]["id"])

    assert detail["assignedOfficerId"] == officer.id
    assert detail["progressNotes"][0]["officerId"] == officer.id
    assert_no_personal_strings(str(detail), where="citizen complaint detail")

    stats = citizen.get(f"/officers/{officer.id}/stats").get_json()
    assert set(stats) == {"officerId", "totalResolved"}


def test_a_photo_link_is_signed_serves_once_valid_and_403s_otherwise(platform, citizen, officer):
    created = platform.file_complaint(citizen)
    photo_url = created["evidence"][0]["photoUrl"]
    assert photo_url.startswith("/api/v1/evidence/")
    assert "exp=" in photo_url and "sig=" in photo_url

    # No token needed — the signature carries the earlier authorization decision.
    served = platform.client.get(photo_url)
    assert served.status_code == 200
    assert served.headers["Cache-Control"].startswith("private, max-age=")
    assert served.get_data().startswith(b"\x89PNG")

    evidence_id = created["evidence"][0]["id"]
    query = photo_url.split("?", 1)[1]
    exp = dict(part.split("=", 1) for part in query.split("&"))["exp"]

    # Tampered signature, missing signature, and an expired window: all 403.
    assert (
        platform.client.get(
            f"/api/v1/evidence/{evidence_id}/photo?exp={exp}&sig=forged"
        ).status_code
        == 403
    )
    assert platform.client.get(f"/api/v1/evidence/{evidence_id}/photo").status_code == 403
    assert (
        platform.client.get(f"/api/v1/evidence/{evidence_id}/photo?exp=1&sig=forged").status_code
        == 403
    )

    # A signature minted for one evidence row does not open another.
    other = platform.file_complaint(citizen)
    other_id = other["evidence"][0]["id"]
    sig = dict(part.split("=", 1) for part in query.split("&"))["sig"]
    assert (
        platform.client.get(f"/api/v1/evidence/{other_id}/photo?exp={exp}&sig={sig}").status_code
        == 403
    )


def test_an_unknown_evidence_id_is_403_not_404(platform, citizen):
    """404 here would let anyone enumerate which evidence rows exist."""
    assert (
        platform.client.get("/api/v1/evidence/999999/photo?exp=99999999999&sig=x").status_code
        == 403
    )


def test_links_are_re_minted_on_every_read(platform, citizen):
    created = platform.file_complaint(citizen)
    first = citizen.complaint(created["id"])["evidence"][0]["photoUrl"]
    second = citizen.complaint(created["id"])["evidence"][0]["photoUrl"]

    # Same picture, and the URL is not an identity or a cache key.
    assert first.split("?")[0] == second.split("?")[0]
    assert platform.client.get(first).get_data() == platform.client.get(second).get_data()


def test_one_citizen_cannot_reach_another_citizens_anything(platform, citizen, populated):
    neighbour = populated["neighbour"]

    citizen.get(f"/complaints/{populated['clustered_b']['id']}", expect=403)
    # The gamification endpoints are strictly first-person — there is no
    # "someone else's points" route to try, and the caller's own is all they get.
    assert citizen.points()["totalLifetimeCsp"] != neighbour.points()["totalLifetimeCsp"]

    # Clusters and zone summaries are officer/admin territory.
    citizen.get(f"/clusters/{populated['cluster_id']}", expect=403)
    citizen.get(f"/zones/{platform.zone_id('north')}/summary", expect=403)


def test_a_reassigned_officer_loses_the_history_they_personally_worked(
    platform, citizen, officer, admin
):
    """Zone scoping beats "I worked on it" — the audit trail is the record."""
    created = platform.file_complaint(citizen)
    platform.accept(created["id"])
    officer.post(f"/officer/complaints/{created['id']}/notes", expect=409, json={"text": "n/a"})

    admin.patch(f"/admin/users/{officer.id}", json={"zoneId": int(platform.zone_id("south"))})

    officer.get(f"/complaints/{created['id']}", expect=403)
    # The admin can still see everything the officer did.
    trail = admin.get(f"/complaints/{created['id']}").get_json()["statusHistory"]
    assert any(entry.get("changedByOfficerId") == officer.id for entry in trail)


def test_an_unauthenticated_caller_gets_nothing_but_the_public_doors(platform):
    client = platform.client
    assert client.get("/health").status_code == 200
    assert client.get("/api/v1/categories").status_code == 200
    assert client.get("/api/v1/zones").status_code == 200

    for path in (
        "/api/v1/complaints/my",
        "/api/v1/feed",
        "/api/v1/officer/complaints",
        "/api/v1/admin/users",
        "/api/v1/users/me",
        "/api/v1/gamification/points",
        "/api/v1/leaderboard?scope=zone",
    ):
        assert client.get(path).status_code == 401, path

    # `/zones/suggest` is deliberately NOT public, unlike the other two lookups
    # the registration form needs.
    assert (
        client.post("/api/v1/zones/suggest", json={"latitude": 12.9, "longitude": 77.6}).status_code
        == 401
    )

    # A forged token is refused just as firmly as a missing one.
    forged = {"Authorization": "Bearer not.a.real.token"}
    assert client.get("/api/v1/users/me", headers=forged).status_code == 401
