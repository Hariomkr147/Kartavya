"""Fixtures for the end-to-end journey suite.

What separates `tests/integration/` from `tests/api/`: **nothing here reaches
into the database to set a scenario up.** `tests/api/` builds its rows with
`session.add(Complaint(status=RESOLVED, ...))`, which is the right trade for
testing one endpoint in isolation — but it means the path that *produces* that
row is never exercised, and a complaint that can only be reached through six
earlier HTTP calls is never actually reached.

So every actor here logs in, and every piece of state is produced by the same
requests a browser would send:

    admin (seeded)  ->  POST /admin/zones      ->  POST /admin/users  (officers)
    citizen         ->  POST /auth/register    ->  POST /complaints   ->  ...

The only sanctioned back doors are two, both deliberate and both marked:

* `Platform.db_shift()` moves stored timestamps backwards. There is no way to
  ask the API to make three days pass, and the SLA clock, the auto-close
  timeout, and the "3 closures in 7 days" badge are all unreachable without it.
* `Platform.rows()` reads the ORM for assertions the API does not expose
  (`sla_paused_seconds`, for instance). Reads only — never writes.

The suite runs on a file-backed SQLite by default and honours
`TEST_DATABASE_URL`, so the same journeys can be pointed at Postgres. That
hook is the point of the file-backed default: three production outages came
from SQL only SQLite accepts, and these journeys touch far more of the query
surface than `tests/unit/test_sql_dialect_portability.py` can compile offline.
It has not yet been run against a live Postgres — wiring that into CI is the
next step, not something this file can claim.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from io import BytesIO
from typing import Any

import pytest

os.environ.setdefault("KARTAVYA_ENV", "testing")

API = "/api/v1"

#: Every account in this suite, except the seeded admin, uses this password.
PASSWORD = "password123"
ADMIN_EMAIL = "admin@kartavya.gov"
ADMIN_PASSWORD = "integration-admin-pw"

#: Metres per degree of latitude, near enough for placing test coordinates.
METRES_PER_DEGREE_LAT = 111_320.0


def pytest_collection_modifyitems(config, items):
    """Mark this package so the layer can be run or skipped as a unit.

    `pytest -m integration` and `pytest -m "not integration"`. Applied here
    rather than as a `pytestmark` in every file so a new journey file cannot
    forget it. The path check matters: a subdirectory conftest still receives
    the whole collected list.
    """
    del config
    for item in items:
        if "tests/integration/" in item.nodeid or item.nodeid.startswith("tests/integration"):
            item.add_marker("integration")


# --- Photo payloads -----------------------------------------------------------
# `app/infra/storage.py` trusts magic bytes and ignores the declared MIME type,
# so these eight bytes are a valid PNG as far as the upload path is concerned.

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8\xff"


def png(name: str = "photo.png", *, payload: bytes = b"integration-photo") -> tuple:
    return (BytesIO(PNG_MAGIC + payload), name)


def jpeg(name: str = "photo.jpg", *, payload: bytes = b"integration-photo") -> tuple:
    return (BytesIO(JPEG_MAGIC + payload), name)


def not_an_image(name: str = "resume.pdf") -> tuple:
    return (BytesIO(b"%PDF-1.7 not an image at all"), name)


# --- One logged-in actor ------------------------------------------------------


class Actor:
    """A role with a real token, talking to the app over HTTP.

    `expect` is a status code, asserted before the response is handed back, so
    a journey that breaks in the middle fails on the step that broke rather
    than on a confusing `KeyError` three calls later.
    """

    def __init__(self, name: str, client, token: str, user: dict[str, Any]) -> None:
        self.name = name
        self.client = client
        self.token = token
        self.user = user

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Actor {self.name} id={self.id} role={self.user.get('role')}>"

    @property
    def id(self) -> str:
        return str(self.user["id"])

    def call(self, method: str, path: str, *, expect: int | None = None, **kwargs):
        headers = dict(kwargs.pop("headers", {}))
        headers.setdefault("Authorization", f"Bearer {self.token}")
        response = self.client.open(API + path, method=method, headers=headers, **kwargs)
        if expect is not None and response.status_code != expect:
            raise AssertionError(
                f"{self.name}: {method} {path} -> {response.status_code}, "
                f"expected {expect}. Body: {_peek(response)}"
            )
        return response

    def get(self, path: str, *, expect: int | None = 200, **kwargs):
        return self.call("GET", path, expect=expect, **kwargs)

    def post(self, path: str, *, expect: int | None = 200, **kwargs):
        return self.call("POST", path, expect=expect, **kwargs)

    def patch(self, path: str, *, expect: int | None = 200, **kwargs):
        return self.call("PATCH", path, expect=expect, **kwargs)

    def delete(self, path: str, *, expect: int | None = 204, **kwargs):
        return self.call("DELETE", path, expect=expect, **kwargs)

    # -- Reads used across several journeys --

    def points(self) -> dict[str, Any]:
        return self.get("/gamification/points").get_json()

    def total_csp(self) -> int:
        return int(self.points()["totalLifetimeCsp"])

    def ledger_reasons(self) -> list[str]:
        return [entry["reason"] for entry in self.points().get("ledger", [])]

    def badge_codes(self) -> list[str]:
        return [badge["code"] for badge in self.get("/gamification/badges").get_json()]

    def complaint(self, complaint_id: str) -> dict[str, Any]:
        return self.get(f"/complaints/{complaint_id}").get_json()

    def status_of(self, complaint_id: str) -> str:
        return str(self.complaint(complaint_id)["status"])


def _peek(response, limit: int = 400) -> str:
    try:
        text = str(response.get_json())
    except Exception:  # pragma: no cover - non-JSON error page
        text = response.get_data(as_text=True)
    return text[:limit]


# --- The provisioned platform -------------------------------------------------


@dataclass
class Platform:
    """A running system with zones, officers, and a way to make citizens."""

    app: Any
    client: Any
    admin: Actor
    zones: dict[str, dict[str, Any]]
    officers: dict[str, Actor]
    categories: dict[str, dict[str, Any]]
    _spot_counter: list[int] = field(default_factory=lambda: [0])
    _email_counter: list[int] = field(default_factory=lambda: [0])

    # -- Reference lookups --

    def category_id(self, code: str = "POTHOLE") -> str:
        return str(self.categories[code]["id"])

    def sla_hours(self, code: str = "POTHOLE") -> int:
        return int(self.categories[code]["slaTargetHours"])

    def zone_id(self, key: str = "north") -> str:
        return str(self.zones[key]["id"])

    def officer(self, key: str = "north") -> Actor:
        return self.officers[key]

    # -- Actors --

    def register_citizen(
        self,
        name: str = "Test Citizen",
        *,
        zone: str = "north",
        email: str | None = None,
        expect: int = 201,
    ):
        """Returns an `Actor` on success, or the raw response when `expect` is
        an error code — there is no session to hand back from a refused signup."""
        self._email_counter[0] += 1
        address = email or f"citizen{self._email_counter[0]}@example.com"
        response = self.client.post(
            f"{API}/auth/register",
            json={
                "name": name,
                "email": address,
                "password": PASSWORD,
                "zoneId": self.zone_id(zone),
            },
        )
        assert response.status_code == expect, _peek(response)
        if expect != 201:
            return response
        body = response.get_json()
        return Actor(name, self.client, body["token"], body["user"])

    def login(self, email: str, password: str = PASSWORD, *, name: str = "actor") -> Actor:
        response = self.client.post(
            f"{API}/auth/login", json={"email": email, "password": password}
        )
        assert response.status_code == 200, _peek(response)
        body = response.get_json()
        return Actor(name, self.client, body["token"], body["user"])

    def create_officer(self, *, zone: str, email: str, name: str = "Officer") -> Actor:
        self.admin.post(
            "/admin/users",
            expect=201,
            json={
                "role": "OFFICER",
                "name": name,
                "email": email,
                "password": PASSWORD,
                "zoneId": int(self.zone_id(zone)),
            },
        )
        return self.login(email, name=name)

    # -- Geography --

    def fresh_spot(self) -> tuple[float, float]:
        """A location ~1.1 km from every other one this fixture has handed out.

        Far outside CLUSTER_RADIUS_METERS (100 m by default), so two complaints
        in the same category never cluster by accident — accidental clustering
        changes both the severity score and which reward a close pays, and it
        would do it silently.
        """
        self._spot_counter[0] += 1
        return (12.90 + self._spot_counter[0] * 0.01, 77.60)

    @staticmethod
    def metres_north(spot: tuple[float, float], metres: float) -> tuple[float, float]:
        lat, lng = spot
        return (lat + metres / METRES_PER_DEGREE_LAT, lng)

    # -- Complaints --

    def file_complaint(
        self,
        citizen: Actor,
        *,
        category: str = "POTHOLE",
        zone: str = "north",
        at: tuple[float, float] | None = None,
        description: str = "There is a deep pothole by the junction.",
        photos: int = 1,
        suggested_by_matcher: bool | None = None,
        expect: int = 201,
    ):
        """POST /complaints as a citizen. Returns the parsed ComplaintDetail."""
        latitude, longitude = at if at is not None else self.fresh_spot()
        data: dict[str, Any] = {
            "categoryId": self.category_id(category),
            "zoneId": self.zone_id(zone),
            "latitude": str(latitude),
            "longitude": str(longitude),
            "description": description,
            "photos": [png(f"evidence-{index}.png") for index in range(photos)],
        }
        if suggested_by_matcher is not None:
            data["categorySuggestedByMatcher"] = "true" if suggested_by_matcher else "false"
        response = citizen.post(
            "/complaints", expect=expect, data=data, content_type="multipart/form-data"
        )
        return response.get_json()

    # -- Lifecycle shortcuts, all through the officer's real endpoints --

    def accept(self, complaint_id: str, *, officer: Actor | None = None) -> dict[str, Any]:
        """SUBMITTED -> EVIDENCE_UNDER_REVIEW -> UNDER_REVIEW (starts the SLA)."""
        acting = officer or self.officer()
        acting.post(f"/officer/complaints/{complaint_id}/claim")
        return acting.post(
            f"/officer/complaints/{complaint_id}/evidence-review",
            json={"verdict": "VALID"},
        ).get_json()

    def drive_to(
        self,
        complaint_id: str,
        target: str,
        *,
        officer: Actor | None = None,
        note: str | None = None,
    ) -> dict[str, Any]:
        """Walk an accepted complaint forward one stage at a time.

        Resumable: stages the complaint has already passed are skipped, so a
        test that hand-drove part of the ladder can hand the rest over here.
        Returns the StatusUpdateResult of the final hop, so a caller pushing to
        RESOLVED can read the `cascade` array off it.
        """
        acting = officer or self.officer()
        ladder = ["IN_PROGRESS", "UNDER_RESOLUTION", "RESOLVED"]
        assert target in ladder, target
        current = acting.status_of(complaint_id)
        start = ladder.index(current) + 1 if current in ladder else 0
        result: dict[str, Any] = {}
        for status in ladder[start : ladder.index(target) + 1]:
            payload: dict[str, Any] = {"status": status}
            if note and status == target:
                payload["note"] = note
            result = acting.patch(
                f"/officer/complaints/{complaint_id}/status", json=payload
            ).get_json()
        return result

    def resolve(self, complaint_id: str, *, officer: Actor | None = None) -> dict[str, Any]:
        """Claim -> accept -> IN_PROGRESS -> UNDER_RESOLUTION -> RESOLVED."""
        self.accept(complaint_id, officer=officer)
        return self.drive_to(complaint_id, "RESOLVED", officer=officer)

    def closed_complaint(
        self, citizen: Actor, *, officer: Actor | None = None, **kwargs
    ) -> dict[str, Any]:
        """File, resolve, and confirm one complaint. Returns the CLOSED detail."""
        created = self.file_complaint(citizen, **kwargs)
        self.resolve(created["id"], officer=officer)
        return citizen.post(f"/complaints/{created['id']}/confirm").get_json()

    # -- The two sanctioned back doors --

    def rows(self):
        """A READ handle on the ORM, for state the API does not expose.

        Expires first, because the background jobs commit from their own app
        context and the outer session would otherwise serve a stale row. That
        expiry is also why this must not be used to write: a pending change is
        discarded by the next `rows()` call. Use `db_shift` / `age_evidence`.
        """
        from app.extensions import db

        db.session.expire_all()
        return db.session

    def db_shift(self, *, complaint_ids: list[str] | None = None, hours: float) -> None:
        """Move a complaint's clock backwards by `hours`.

        The alternative is a test that waits three real days. Every business
        timestamp on the row moves together — shifting `sla_started_at` alone
        would produce a complaint that was resolved before it was accepted, and
        the analytics endpoints would then be asserted against nonsense.
        """
        from app.extensions import db
        from app.models import Complaint, StatusHistory

        delta = timedelta(hours=hours)
        query = db.session.query(Complaint)
        if complaint_ids is not None:
            query = query.filter(Complaint.id.in_([int(cid) for cid in complaint_ids]))
        for complaint in query.all():
            for column in (
                "created_at",
                "updated_at",
                "sla_started_at",
                "sla_paused_at",
                "resolved_at",
                "closed_at",
            ):
                value = getattr(complaint, column, None)
                if value is not None:
                    setattr(complaint, column, value - delta)
            for entry in db.session.query(StatusHistory).filter(
                StatusHistory.complaint_id == complaint.id
            ):
                entry.created_at = entry.created_at - delta
        db.session.commit()
        db.session.expire_all()

    def age_evidence(self, evidence_id: str, *, hours: float) -> None:
        """Backdate one evidence row, for the screening-retry age window."""
        from app.extensions import db
        from app.models import ComplaintEvidence

        db.session.expire_all()
        row = db.session.get(ComplaintEvidence, int(evidence_id))
        assert row is not None, evidence_id
        row.created_at = row.created_at - timedelta(hours=hours)
        db.session.commit()

    def deactivate(self, user_id: str) -> None:
        self.admin.patch(f"/admin/users/{user_id}", json={"active": False})


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


# --- Fixtures -----------------------------------------------------------------


@pytest.fixture
def integration_app(tmp_path, monkeypatch):
    """A seeded app on its own database, with uploads under `tmp_path`.

    File-backed rather than `sqlite://` because photos are written to disk and
    a journey that uploads one should be able to fetch it back through the
    signed photo route.
    """
    monkeypatch.setenv("KARTAVYA_ENV", "testing")
    monkeypatch.setenv("KARTAVYA_ADMIN_EMAIL", ADMIN_EMAIL)
    monkeypatch.setenv("KARTAVYA_ADMIN_PASSWORD", ADMIN_PASSWORD)

    from app import create_app
    from app.extensions import db
    from app.seed import seed_all
    from app.settings import TestingConfig

    config = TestingConfig()
    config.SQLALCHEMY_DATABASE_URI = os.environ.get(
        "TEST_DATABASE_URL", f"sqlite:///{(tmp_path / 'journey.sqlite3').as_posix()}"
    )
    config.UPLOAD_DIR = tmp_path / "uploads"

    application = create_app(config)
    with application.app_context():
        db.create_all()
        seed_all()
        yield application
        db.session.remove()
        db.drop_all()


@pytest.fixture
def platform(integration_app) -> Platform:
    """Zones and officers provisioned the way an admin actually provisions them.

    Two real zones plus the seeded catch-all, so cross-zone scoping has
    somewhere to fail. `south` gets no officer of its own by default — several
    journeys need a zone whose complaints nobody is scoped to.
    """
    client = integration_app.test_client()

    response = client.post(
        f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    assert response.status_code == 200, _peek(response)
    body = response.get_json()
    admin = Actor("admin", client, body["token"], body["user"])

    zones: dict[str, dict[str, Any]] = {}
    for key, code, name, lat, lng in (
        ("north", "WARD-12-N", "Ward 12 - North", 12.9716, 77.5946),
        ("south", "WARD-07-S", "Ward 7 - South", 12.9510, 77.5712),
    ):
        zones[key] = admin.post(
            "/admin/zones",
            expect=201,
            json={"code": code, "name": name, "centerLat": lat, "centerLng": lng},
        ).get_json()

    catch_all = [
        zone
        for zone in client.get(f"{API}/zones").get_json()
        if str(zone["id"]) not in {str(zones["north"]["id"]), str(zones["south"]["id"])}
    ]
    assert catch_all, "the seed must leave exactly one catch-all zone"
    zones["catch_all"] = catch_all[0]

    categories = {
        category["code"]: category for category in client.get(f"{API}/categories").get_json()
    }

    platform = Platform(
        app=integration_app,
        client=client,
        admin=admin,
        zones=zones,
        officers={},
        categories=categories,
    )
    platform.officers["north"] = platform.create_officer(
        zone="north", email="officer.north@kartavya.gov", name="North Officer"
    )
    return platform


@pytest.fixture
def citizen(platform) -> Actor:
    return platform.register_citizen("Asha Verma", email="asha@example.com")


@pytest.fixture
def officer(platform) -> Actor:
    return platform.officer("north")


@pytest.fixture
def admin(platform) -> Actor:
    return platform.admin
