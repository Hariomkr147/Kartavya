from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier

from flask import Flask
from sqlalchemy import func, select

from app.infra.ai.base import AiProvider, ScreenResult
from app.infra.ai.breaker import GuardedProvider
from app.jobs import screening


def _guarded(provider: AiProvider) -> GuardedProvider:
    """The wrapper every caller goes through — jobs never touch a raw provider."""
    return GuardedProvider(
        provider,
        timeout_seconds=2,
        failure_threshold=5,
        cooldown_seconds=120,
        executor_workers=1,
    )


def _configured_app() -> Flask:
    app = Flask(__name__)
    app.config.update(
        AI_PROVIDER="stub",
        AI_TIMEOUT_SECONDS=1.0,
        AI_BREAKER_FAILURE_THRESHOLD=2,
        AI_BREAKER_COOLDOWN_SECONDS=120,
        AI_WORKER_THREADS=3,
    )
    return app


def test_screening_provider_is_reused_per_application(monkeypatch):
    app = _configured_app()
    provider = object()
    calls = []

    def fake_build_provider(name, **options):
        calls.append((name, options))
        return provider

    monkeypatch.setattr(screening, "build_provider", fake_build_provider)

    assert screening._get_screening_provider(app) is provider
    assert screening._get_screening_provider(app) is provider
    assert calls == [
        (
            "stub",
            {
                "timeout_seconds": 1.0,
                "failure_threshold": 2,
                "cooldown_seconds": 120,
                "executor_workers": 3,
            },
        )
    ]


def test_submit_evidence_screening_honours_the_enable_flag(monkeypatch):
    """The switch is AI_SCREENING_ENABLED, not TESTING.

    Tying it to TESTING left the real submission path with no coverage at all
    and silently disabled screening for anyone who set that flag for other
    reasons.
    """
    app = _configured_app()
    submitted = []

    class RecordingExecutor:
        def submit(self, _fn, *args):
            submitted.append(args)

    monkeypatch.setattr(screening, "_executor", RecordingExecutor())
    monkeypatch.setattr(screening, "build_provider", lambda name, **options: object())

    app.config["AI_SCREENING_ENABLED"] = False
    screening.submit_evidence_screening(app, [1, 2, 3])
    assert submitted == []

    app.config["AI_SCREENING_ENABLED"] = True
    screening.submit_evidence_screening(app, [1, 2, 3])
    assert [evidence_id for _app, evidence_id, _provider in submitted] == [1, 2, 3]


def test_shared_screening_provider_retains_three_photo_concurrency():
    started = Barrier(3)

    class ConcurrentProvider:
        def screen_photo(self, path, category):
            started.wait(timeout=1)
            return ScreenResult(True, 0.9, path)

        def zone_report(self, stats):  # pragma: no cover - not used by screening
            raise AssertionError

    provider = GuardedProvider(
        ConcurrentProvider(),
        timeout_seconds=2,
        failure_threshold=5,
        cooldown_seconds=120,
        executor_workers=3,
    )

    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(
            executor.map(
                lambda index: provider.screen_photo(str(index), "Pothole"),
                range(3),
            )
        )

    assert [result.note for result in results] == ["0", "1", "2"]


def test_shared_screening_breaker_accumulates_none_failures_across_jobs():
    class UnavailableProvider:
        def __init__(self):
            self.calls = 0

        def screen_photo(self, path, category):
            self.calls += 1
            return None

        def zone_report(self, stats):  # pragma: no cover
            return None

    underlying = UnavailableProvider()
    provider = GuardedProvider(
        underlying,
        timeout_seconds=1,
        failure_threshold=2,
        cooldown_seconds=120,
        executor_workers=3,
    )

    for index in range(5):
        assert provider.screen_photo(f"{index}.png", "Pothole") is None

    # Two failures open the breaker. The remaining three calls are short-circuited.
    assert underlying.calls == 2


def test_guarded_provider_converts_unexpected_exception_to_none():
    class RaisingProvider:
        def __init__(self):
            self.calls = 0

        def screen_photo(self, path, category):
            self.calls += 1
            raise RuntimeError("model crashed")

        def zone_report(self, stats):  # pragma: no cover
            raise RuntimeError("model crashed")

    underlying = RaisingProvider()
    provider = GuardedProvider(
        underlying,
        timeout_seconds=1,
        failure_threshold=5,
        cooldown_seconds=120,
        executor_workers=3,
    )

    # The exception must not escape into the job or endpoint.
    assert provider.screen_photo("photo.png", "Pothole") is None
    assert underlying.calls == 1


def _evidence_fixture(app):
    """One complaint with one PENDING evidence row, in its own app context."""
    from app.domain.enums import AiScreenStatus, ComplaintStatus, UserRole
    from app.extensions import db
    from app.models import Complaint, ComplaintCategory, ComplaintEvidence, User, Zone
    from app.services.accounts.auth import hash_password

    with app.app_context():
        zone = db.session.execute(select(Zone).where(Zone.is_catch_all.is_(True))).scalar_one()
        category = db.session.execute(select(ComplaintCategory)).scalars().first()
        citizen = User(
            full_name="Screening Citizen",
            display_name=None,
            email="screening@example.com",
            # ggignore
            password_hash=hash_password("password123"),
            role=UserRole.CITIZEN,
            zone_id=zone.id,
            is_active=True,
        )
        db.session.add(citizen)
        db.session.flush()
        complaint = Complaint(
            complaint_code="KTV-2026-000900",
            citizen_id=citizen.id,
            zone_id=zone.id,
            category_id=category.id,
            description="Broken road",
            category_suggested_by_matcher=False,
            latitude=12.0,
            longitude=77.0,
            status=ComplaintStatus.SUBMITTED,
            severity_score=0,
            updated_at=datetime.now(UTC).replace(tzinfo=None),
        )
        db.session.add(complaint)
        db.session.flush()
        evidence = ComplaintEvidence(
            complaint_id=complaint.id,
            sequence=1,
            file_path=f"{complaint.id}/photo.png",
            ai_screen_status=AiScreenStatus.PENDING,
            created_at=datetime.now(UTC).replace(tzinfo=None),
        )
        db.session.add(evidence)
        db.session.commit()
        return evidence.id


def _screen_result(app, evidence_id) -> dict:
    """Read the screening columns back as plain values.

    Plain values, not the ORM row: the instance would be detached the moment
    this app context pops.
    """
    from app.extensions import db
    from app.models import ComplaintEvidence

    with app.app_context():
        evidence = db.session.get(ComplaintEvidence, evidence_id)
        return {
            "status": evidence.ai_screen_status,
            "matches_category": evidence.ai_matches_category,
            "confidence": evidence.ai_confidence,
            "note": evidence.ai_note,
            "verdict": evidence.verdict,
        }


def test_screen_evidence_records_a_result_as_done(seeded_app):
    from app.domain.enums import AiScreenStatus

    evidence_id = _evidence_fixture(seeded_app)

    class ResultProvider:
        def screen_photo(self, path, category):
            return ScreenResult(True, 0.82, "Looks like the selected category.")

        def zone_report(self, stats):  # pragma: no cover - not used by screening
            raise AssertionError

    screening.screen_evidence(seeded_app, evidence_id, _guarded(ResultProvider()))

    result = _screen_result(seeded_app, evidence_id)
    assert result["status"] is AiScreenStatus.DONE
    assert result["matches_category"] is True
    assert result["confidence"] == 0.82
    assert result["note"] == "Looks like the selected category."


def test_screen_evidence_records_a_missing_model_as_unavailable(seeded_app):
    """`None` is a documented outcome, not an error — the UI renders it."""
    from app.domain.enums import AiScreenStatus
    from app.infra.ai.null import NullProvider

    evidence_id = _evidence_fixture(seeded_app)

    screening.screen_evidence(seeded_app, evidence_id, _guarded(NullProvider()))

    result = _screen_result(seeded_app, evidence_id)
    assert result["status"] is AiScreenStatus.UNAVAILABLE
    assert result["matches_category"] is None
    assert result["confidence"] is None


def test_screen_evidence_never_changes_complaint_status(seeded_app):
    """Advisory only. A model verdict must never move a complaint or cost points."""
    from app.domain.enums import ComplaintStatus
    from app.extensions import db
    from app.models import Complaint, ComplaintEvidence, PointsLedger

    evidence_id = _evidence_fixture(seeded_app)

    class RejectingProvider:
        def screen_photo(self, path, category):
            return ScreenResult(False, 0.97, "Does not match the category at all.")

        def zone_report(self, stats):  # pragma: no cover - not used by screening
            raise AssertionError

    screening.screen_evidence(seeded_app, evidence_id, _guarded(RejectingProvider()))

    with seeded_app.app_context():
        evidence = db.session.get(ComplaintEvidence, evidence_id)
        complaint = db.session.get(Complaint, evidence.complaint_id)
        assert complaint.status is ComplaintStatus.SUBMITTED
        assert evidence.verdict is None
        assert (
            db.session.execute(
                select(func.count(PointsLedger.id)).where(
                    PointsLedger.complaint_id == complaint.id
                )
            ).scalar_one()
            == 0
        )
