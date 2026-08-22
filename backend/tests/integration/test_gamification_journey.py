"""Points, badges, and the leaderboard, earned rather than inserted.

Every total here is the sum of a ledger that real actions wrote. That is the
point: `totalLifetimeCsp` is `SUM(points_ledger.points_change)` with no stored
counterpart, so the only way to test it honestly is to make the events happen.
"""

from __future__ import annotations


def test_the_ledger_is_the_only_source_of_the_total(platform, citizen, officer):
    """Five events, five rows, and a total that is exactly their sum."""
    first = platform.file_complaint(citizen)  # FIRST_COMPLAINT +10
    neighbour = platform.register_citizen("Neighbour", email="csp-neighbour@example.com")
    neighbour.post(f"/complaints/{first['id']}/upvote")  # UPVOTE_RECEIVED +5

    platform.resolve(first["id"])
    citizen.post(f"/complaints/{first['id']}/confirm")  # +50 and +15

    second = platform.file_complaint(citizen)
    officer.post(f"/officer/complaints/{second['id']}/claim")
    officer.post(
        f"/officer/complaints/{second['id']}/evidence-review",
        json={"verdict": "REJECTED", "reason": "Staged photo."},
    )  # REJECTED_PENALTY -20

    points = citizen.points()
    amounts = {entry["reason"]: entry["amount"] for entry in points["ledger"]}
    assert amounts == {
        "FIRST_COMPLAINT": 10,
        "UPVOTE_RECEIVED": 5,
        "COMPLAINT_CLOSED": 50,
        "ON_TIME_BONUS": 15,
        "REJECTED_PENALTY": -20,
    }
    assert points["totalLifetimeCsp"] == sum(amounts.values()) == 60
    assert points["currentMonthCsp"] == 60

    # Every credit points back at the complaint that caused it.
    for entry in points["ledger"]:
        assert entry["complaintId"] in {first["id"], second["id"]}
        assert entry["createdAt"].endswith("Z")


def test_only_the_first_complaint_ever_pays_the_starter_bonus(platform, citizen):
    platform.file_complaint(citizen)
    platform.file_complaint(citizen)
    platform.file_complaint(citizen)

    assert citizen.ledger_reasons().count("FIRST_COMPLAINT") == 1
    assert citizen.total_csp() == 10


def test_the_ledger_pages(platform, citizen):
    for _ in range(3):
        platform.closed_complaint(citizen)

    first_page = citizen.get("/gamification/points?page=1&pageSize=2").get_json()
    assert len(first_page["ledger"]) == 2
    assert first_page["pagination"]["totalItems"] == 7  # 1 first-complaint + 3 x (close + bonus)
    # The summary is computed over everything, not over the page.
    assert first_page["totalLifetimeCsp"] == 205


def test_badges_unlock_as_their_criteria_are_met(platform, citizen):
    """Each badge earned by crossing its own real threshold, in one lifetime."""
    assert citizen.badge_codes() == []

    platform.file_complaint(citizen)
    assert "KARTAVYA_INITIATE" in citizen.badge_codes()

    # Two closes: 10 + 2 x 65 = 140 lifetime, crossing the 100-point badge.
    for _ in range(2):
        platform.closed_complaint(citizen)
    assert citizen.total_csp() == 140
    assert "CENTURY_REFORMER" in citizen.badge_codes()
    assert "STREET_GUARDIAN" not in citizen.badge_codes()  # needs 5 closed
    assert "CIVIC_HERO" not in citizen.badge_codes()  # needs 500

    for _ in range(3):
        platform.closed_complaint(citizen)
    codes = citizen.badge_codes()
    assert "STREET_GUARDIAN" in codes  # 5 confirmed closures
    # 3 closures inside a 7-day window, which just happened.
    assert "SWIFT_REPORTER" in codes

    badge = [
        row
        for row in citizen.get("/gamification/badges").get_json()
        if row["code"] == "STREET_GUARDIAN"
    ][0]
    assert badge["name"] == "Street Guardian"
    assert badge["earnedAt"].endswith("Z")


def test_a_badge_is_awarded_once_and_only_once(platform, citizen):
    for _ in range(6):
        platform.closed_complaint(citizen)

    codes = citizen.badge_codes()
    assert len(codes) == len(set(codes))
    assert codes.count("STREET_GUARDIAN") == 1


def test_an_auto_closed_complaint_credits_nothing_at_all(platform, citizen, admin):
    """The timeout closes it; nobody did the verification, so nobody is paid."""
    admin.patch("/admin/settings", json={"autoCloseTimeoutHours": 24})
    created = platform.file_complaint(citizen)
    platform.resolve(created["id"])
    before = citizen.total_csp()

    platform.db_shift(complaint_ids=[created["id"]], hours=30)

    from app.jobs.auto_close import sweep_auto_close

    assert sweep_auto_close(platform.app) == 1

    assert citizen.status_of(created["id"]) == "CLOSED"
    assert citizen.total_csp() == before
    assert "COMPLAINT_CLOSED" not in citizen.ledger_reasons()

    entry = [
        row
        for row in citizen.complaint(created["id"])["statusHistory"]
        if row["toStatus"] == "CLOSED"
    ][0]
    assert entry["changedByRole"] == "SYSTEM"

    # A second sweep has nothing left to do.
    assert sweep_auto_close(platform.app) == 0


def test_the_sweeper_leaves_complaints_inside_the_window_alone(platform, citizen, admin):
    admin.patch("/admin/settings", json={"autoCloseTimeoutHours": 168})
    created = platform.file_complaint(citizen)
    platform.resolve(created["id"])

    platform.db_shift(complaint_ids=[created["id"]], hours=100)

    from app.jobs.auto_close import sweep_auto_close

    assert sweep_auto_close(platform.app) == 0
    assert citizen.status_of(created["id"]) == "RESOLVED"


def test_the_leaderboard_ranks_sequentially_and_flags_the_caller(platform):
    """Ranks are 1..N with no gaps and no ties sharing a number."""
    leaders = []
    for index in range(4):
        actor = platform.register_citizen(f"Player {index}", email=f"player{index}@example.com")
        for _ in range(index):  # 0, 1, 2, 3 closed complaints
            platform.closed_complaint(actor)
        leaders.append(actor)

    board = leaders[0].get("/leaderboard?scope=zone&period=all_time").get_json()

    assert [row["rank"] for row in board["data"]] == [1, 2, 3, 4]
    assert [row["citizenId"] for row in board["data"]] == [
        leaders[3].id,
        leaders[2].id,
        leaders[1].id,
        leaders[0].id,
    ]
    assert [row["isTopThree"] for row in board["data"]] == [True, True, True, False]

    # A citizen with nothing still appears, at the bottom — that is the nudge.
    assert board["data"][-1]["points"] == 0
    assert board["data"][-1]["isCurrentUser"] is True
    assert board["currentUser"]["rank"] == 4


def test_the_callers_rank_is_computed_against_the_whole_board(platform):
    players = []
    for index in range(5):
        actor = platform.register_citizen(f"Ranked {index}", email=f"ranked{index}@example.com")
        for _ in range(index):
            platform.closed_complaint(actor)
        players.append(actor)

    # The weakest player asks for page 1 and still learns they are last.
    page_one = (
        players[0].get("/leaderboard?scope=zone&period=all_time&page=1&pageSize=2").get_json()
    )

    assert [row["rank"] for row in page_one["data"]] == [1, 2]
    assert page_one["currentUser"]["rank"] == 5
    assert page_one["currentUser"]["isCurrentUser"] is True
    assert page_one["pagination"]["totalItems"] == 5


def test_a_deactivated_citizen_drops_off_and_everyone_below_moves_up(platform, admin):
    strong = platform.register_citizen("Strong", email="strong@example.com")
    middle = platform.register_citizen("Middle", email="middle@example.com")
    weak = platform.register_citizen("Weak", email="weak@example.com")
    for _ in range(2):
        platform.closed_complaint(strong)
    platform.closed_complaint(middle)

    before = weak.get("/leaderboard?scope=zone&period=all_time").get_json()
    assert before["currentUser"]["rank"] == 3

    platform.deactivate(strong.id)

    after = weak.get("/leaderboard?scope=zone&period=all_time").get_json()
    assert strong.id not in {row["citizenId"] for row in after["data"]}
    assert after["currentUser"]["rank"] == 2

    # The ledger survives, so reactivating restores the place.
    admin.patch(f"/admin/users/{strong.id}", json={"active": True})
    restored = weak.get("/leaderboard?scope=zone&period=all_time").get_json()
    assert restored["data"][0]["citizenId"] == strong.id
    assert restored["currentUser"]["rank"] == 3


def test_the_board_shows_handles_and_never_real_names(platform):
    named = platform.register_citizen("Priya Sharma", email="priya@example.com")
    platform.closed_complaint(named)

    board = named.get("/leaderboard?scope=city&period=all_time").get_json()
    row = board["data"][0]

    assert row["displayName"] == f"Citizen #{named.id}"
    assert "Priya" not in str(board)
    assert "priya@example.com" not in str(board)

    named.patch("/users/me", json={"displayName": "RoadWatcher"})
    assert (
        named.get("/leaderboard?scope=city&period=all_time").get_json()["data"][0]["displayName"]
        == "RoadWatcher"
    )


def test_zone_and_city_scopes_cover_different_populations(platform):
    northerner = platform.register_citizen("Northerner", email="lb-north@example.com")
    southerner = platform.register_citizen("Southerner", email="lb-south@example.com", zone="south")
    south_officer = platform.create_officer(zone="south", email="officer.south-lb@kartavya.gov")
    platform.closed_complaint(southerner, zone="south", officer=south_officer)

    zone_board = northerner.get("/leaderboard?scope=zone&period=all_time").get_json()
    assert southerner.id not in {row["citizenId"] for row in zone_board["data"]}

    city_board = northerner.get("/leaderboard?scope=city&period=all_time").get_json()
    assert southerner.id in {row["citizenId"] for row in city_board["data"]}


def test_officers_and_admins_are_never_ranked(platform, citizen, officer, admin):
    """They earn no points, so they hold no row on any board."""
    platform.closed_complaint(citizen)

    board = citizen.get("/leaderboard?scope=city&period=all_time").get_json()
    ranked = {row["citizenId"] for row in board["data"]}

    assert officer.id not in ranked
    assert admin.id not in ranked


def test_the_gamification_group_is_citizen_only(platform, citizen, officer, admin):
    """These reads are guarded the same way, and now say so.

    The 403 used to be implemented on all of them and documented on none, while
    `/feed` and `POST /complaints` — guarded identically — did document it.
    `openapi.yaml` now carries it, so this test is checking the contract rather
    than just the code.
    """
    for path in (
        "/complaints/my",
        "/gamification/points",
        "/gamification/badges",
    ):
        citizen.get(path)
        officer.get(path, expect=403)
        admin.get(path, expect=403)


def test_the_leaderboard_is_the_one_read_an_admin_shares(platform, citizen, officer, admin):
    """Contract 3.1.0 widened `/leaderboard` to admins, and only `/leaderboard`.

    It is the exception to the rule above, so it is asserted apart from it:
    officers stay out, and an admin reading the board is never *on* it —
    `currentUser` is null and no row is theirs.
    """
    path = "/leaderboard?scope=city&period=all_time"
    citizen.get(path)
    officer.get(path, expect=403)

    board = admin.get(path).get_json()
    assert board["currentUser"] is None
    assert all(entry["citizenId"] != admin.id for entry in board["data"])


def test_zone_champion_belongs_to_whoever_is_actually_first(platform):
    """A rank-1 citizen earns it; the runner-up does not."""
    leader = platform.register_citizen("Leader", email="champ-leader@example.com")
    runner_up = platform.register_citizen("Runner Up", email="champ-second@example.com")

    for _ in range(2):
        platform.closed_complaint(leader)
    platform.closed_complaint(runner_up)

    assert (
        leader.get("/leaderboard?scope=zone&period=all_time").get_json()["currentUser"]["rank"] == 1
    )
    assert "ZONE_CHAMPION" in leader.badge_codes()
    assert "ZONE_CHAMPION" not in runner_up.badge_codes()


def test_the_leaderboard_scope_is_mandatory(platform, citizen):
    citizen.get("/leaderboard", expect=400)
    citizen.get("/leaderboard?scope=planet", expect=400)
    citizen.get("/leaderboard?scope=zone&period=yesterday", expect=400)
