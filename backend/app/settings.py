"""Environment-driven configuration. See backend/.env.example for the full list.

Config objects are instances, not classes, so the environment is read when
`create_app()` runs rather than at import time — which is what lets a test set
`KARTAVYA_ENV=testing` and get a clean config without import-order games.
"""

from __future__ import annotations

import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent

#: The `servers` entry in openapi.yaml. Every contract path hangs off this.
API_PREFIX = "/api/v1"

#: Values here are only acceptable while KARTAVYA_ENV=development.
_DEV_JWT_SECRET = "dev-only-jwt-secret-change-me"
_DEV_PHOTO_KEY = "dev-only-photo-signing-key-change-me"


def normalize_database_url(url: str) -> str:
    """Make a hosted Postgres URL usable by SQLAlchemy 2 as-is.

    Two long-standing footguns, both of which look like a broken deployment
    rather than a URL problem:

    1. Several providers still hand out `postgres://`. SQLAlchemy 2 removed
       that alias and raises `Can't load plugin: sqlalchemy.dialects:postgres`.
    2. A bare `postgresql://` selects psycopg2, which is not a dependency here.
       This project installs psycopg 3, so the driver has to be named.

    Anything already carrying an explicit driver (`postgresql+psycopg://`,
    `postgresql+psycopg2://`, …) and every non-Postgres URL is left untouched,
    so pasting Neon's connection string verbatim just works.
    """
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw else default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    return float(raw) if raw else default


class BaseConfig:
    """Shared defaults. Subclasses override only what differs."""

    ENV_NAME = "base"
    DEBUG = False
    TESTING = False

    def __init__(self) -> None:
        # --- Persistence ---
        self.SQLALCHEMY_DATABASE_URI = normalize_database_url(
            os.environ.get(
                "DATABASE_URL", f"sqlite:///{BACKEND_ROOT / 'instance' / 'kartavya.sqlite3'}"
            )
        )
        self.SQLALCHEMY_TRACK_MODIFICATIONS = False
        self.SQLALCHEMY_ECHO = _env_bool("SQLALCHEMY_ECHO", False)
        # Postgres only. Neon (and any pooler) drops idle connections, and a
        # pooled connection that died while the free instance was asleep
        # otherwise surfaces as a failed request on the next wake-up.
        if self.SQLALCHEMY_DATABASE_URI.startswith("postgresql"):
            self.SQLALCHEMY_ENGINE_OPTIONS = {
                "pool_pre_ping": True,
                "pool_recycle": 300,
            }

        # --- Secrets ---
        # Two separate secrets on purpose: leaking the photo key must not hand
        # anyone the ability to mint an admin JWT.
        self.JWT_SECRET = os.environ.get("JWT_SECRET", _DEV_JWT_SECRET)
        self.JWT_ALGORITHM = "HS256"
        self.JWT_TTL_HOURS = _env_int("JWT_TTL_HOURS", 24)
        self.PHOTO_SIGNING_KEY = os.environ.get("PHOTO_SIGNING_KEY", _DEV_PHOTO_KEY)
        self.PHOTO_URL_TTL_SECONDS = _env_int("PHOTO_URL_TTL_SECONDS", 86_400)
        # Flask's own session signing key. Unused today (the API is stateless
        # and token-based) but Flask wants one present.
        self.SECRET_KEY = os.environ.get("FLASK_SECRET_KEY", self.JWT_SECRET)

        # --- Photo storage ---
        self.UPLOAD_DIR = Path(
            os.environ.get("UPLOAD_DIR", BACKEND_ROOT / "instance" / "uploads")
        )
        self.MAX_UPLOAD_BYTES = _env_int("MAX_UPLOAD_BYTES", 5 * 1024 * 1024)
        self.MAX_PHOTOS_PER_COMPLAINT = 3
        self.ALLOWED_PHOTO_MIME_TYPES = ("image/jpeg", "image/png")

        # --- AI (never blocks a request; failure mode is None) ---
        self.AI_PROVIDER = os.environ.get("AI_PROVIDER", "stub")
        self.AI_TIMEOUT_SECONDS = _env_float("AI_TIMEOUT_SECONDS", 10.0)
        self.AI_BREAKER_FAILURE_THRESHOLD = _env_int("AI_BREAKER_FAILURE_THRESHOLD", 5)
        self.AI_BREAKER_COOLDOWN_SECONDS = _env_int("AI_BREAKER_COOLDOWN_SECONDS", 120)
        self.AI_WORKER_THREADS = _env_int("AI_WORKER_THREADS", 3)
        self.AI_API_KEY = os.environ.get("AI_API_KEY", "")
        self.AI_API_URL = os.environ.get(
            "AI_API_URL", "https://api.openai.com/v1/chat/completions"
        )
        self.AI_MODEL_NAME = os.environ.get("AI_MODEL_NAME", "gpt-4o-mini")
        self.AI_LOCAL_URL = os.environ.get("AI_LOCAL_URL", "http://localhost:11434")
        self.AI_LOCAL_VISION_MODEL = os.environ.get("AI_LOCAL_VISION_MODEL", "llava")
        self.AI_LOCAL_TEXT_MODEL = os.environ.get("AI_LOCAL_TEXT_MODEL", "llama3")
        # Screening is fire-and-forget, so a test that submits evidence would
        # otherwise race a background thread against its own assertions. This is
        # the switch for that — not `TESTING`, so a test can still turn the real
        # submission path on and assert it queues.
        self.AI_SCREENING_ENABLED = _env_bool("AI_SCREENING_ENABLED", True)
        # Screening that never landed is otherwise permanent: an UNAVAILABLE
        # row is never retried, and a PENDING row whose task died with its
        # process is never picked up at all. The sweeper re-queues both.
        self.AI_SCREENING_RETRY_MINUTES = _env_int("AI_SCREENING_RETRY_MINUTES", 10)
        # Bounded by AGE rather than a per-row attempt count, which would need a
        # column complaint_evidence does not have. Past this, a row is never
        # retried again.
        #
        # 6 hours, not 24: the failures worth recovering from are transient — a
        # rate-limit burst clears in minutes, a provider outage in hours. The
        # window also sets the worst case, since a row that keeps failing stays
        # eligible for all of it. At a 10-minute cadence that is ~36 attempts
        # for a photo the model will never accept (a corrupt file, say), which
        # is the price of not having an attempts column to count against.
        self.AI_SCREENING_RETRY_WINDOW_HOURS = _env_int(
            "AI_SCREENING_RETRY_WINDOW_HOURS", 6
        )
        # Caps what one sweep can cost against a rate-limited provider.
        self.AI_SCREENING_RETRY_BATCH = _env_int("AI_SCREENING_RETRY_BATCH", 25)
        # How long a row may sit PENDING before it is assumed orphaned — its
        # task died with the process — and re-queued.
        #
        # Deliberately generous. There is no "last attempted" timestamp on
        # complaint_evidence (it is append-only and carries only created_at),
        # so staleness is measured from creation. A row re-queued by an earlier
        # sweep therefore still looks old, and if its task has not finished the
        # next sweep would queue it again. In practice screening resolves in
        # seconds, but a burst can back up the three screening threads, so this
        # sits far beyond any plausible queue wait. A duplicate is harmless
        # anyway — screening only rewrites advisory fields — but it wastes a
        # call against a rate-limited provider.
        self.AI_SCREENING_STALE_PENDING_MINUTES = _env_int(
            "AI_SCREENING_STALE_PENDING_MINUTES", 60
        )

        # --- Domain tuning ---
        # Cluster radius is config, not a domain constant: it is a tuning knob,
        # and domain/geo.py takes it as an argument so tests can vary it.
        self.CLUSTER_RADIUS_METERS = _env_float("CLUSTER_RADIUS_METERS", 100.0)
        # Sweep cadence only bounds how *late* an auto-close lands. The timeout
        # itself is a live rule read from app_settings on every pass.
        self.AUTO_CLOSE_SWEEP_MINUTES = _env_int("AUTO_CLOSE_SWEEP_MINUTES", 15)
        self.SCHEDULER_ENABLED = _env_bool("SCHEDULER_ENABLED", True)

        # --- Pagination (openapi.yaml: Page / PageSize) ---
        self.DEFAULT_PAGE_SIZE = 20
        self.MAX_PAGE_SIZE = 100

        # --- CORS ---
        self.CORS_ORIGINS = [
            origin.strip()
            for origin in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")
            if origin.strip()
        ]

    def validate(self) -> None:
        """Fail fast at startup rather than silently signing with a dev default.

        A production deployment that quietly kept `dev-only-jwt-secret-change-me`
        would let anyone who has read this repository mint an admin token.
        """
        insecure: list[str] = []
        if self.JWT_SECRET == _DEV_JWT_SECRET:
            insecure.append("JWT_SECRET")
        if self.PHOTO_SIGNING_KEY == _DEV_PHOTO_KEY:
            insecure.append("PHOTO_SIGNING_KEY")
        if insecure:
            raise RuntimeError(
                f"{', '.join(insecure)} still set to the development default while "
                f"KARTAVYA_ENV={self.ENV_NAME}. Set real secrets before starting."
            )
        if self.JWT_SECRET == self.PHOTO_SIGNING_KEY:
            raise RuntimeError(
                "JWT_SECRET and PHOTO_SIGNING_KEY must be different secrets."
            )


class DevelopmentConfig(BaseConfig):
    ENV_NAME = "development"
    DEBUG = True

    def validate(self) -> None:
        """Dev is allowed to run on the checked-in defaults. Nothing else is."""
        return


class TestingConfig(BaseConfig):
    ENV_NAME = "testing"
    TESTING = True

    def __init__(self) -> None:
        super().__init__()
        self.SQLALCHEMY_DATABASE_URI = os.environ.get("TEST_DATABASE_URL", "sqlite://")
        self.AI_PROVIDER = "stub"
        # A background scheduler inside a test suite is a source of flakes and
        # cross-test state. Jobs are called directly in tests/services/ instead.
        self.SCHEDULER_ENABLED = False
        # Same reasoning for per-photo screening. Tests that want the submission
        # path flip this back on explicitly.
        self.AI_SCREENING_ENABLED = False

    def validate(self) -> None:
        return


class ProductionConfig(BaseConfig):
    ENV_NAME = "production"


_CONFIGS: dict[str, type[BaseConfig]] = {
    "development": DevelopmentConfig,
    "testing": TestingConfig,
    "production": ProductionConfig,
}


def load_config(env_name: str | None = None) -> BaseConfig:
    """Build the config for `KARTAVYA_ENV` (default: development) and check it."""
    name = (env_name or os.environ.get("KARTAVYA_ENV") or "development").strip().lower()
    if name not in _CONFIGS:
        raise RuntimeError(
            f"Unknown KARTAVYA_ENV={name!r}. Expected one of: {', '.join(_CONFIGS)}."
        )
    config = _CONFIGS[name]()
    config.validate()
    return config
