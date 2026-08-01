"""The application factory.

    flask --app app run          # development
    gunicorn --workers 1 --threads 8 "app:create_app()"

⚠ Threads, not multiple processes, while we are on SQLite. Several gunicorn
*processes* against one SQLite file produce SQLITE_BUSY under write contention.
If the app outgrows this, the only change is Postgres plus more workers —
nothing in the architecture assumes SQLite.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.settings import API_PREFIX, BaseConfig, load_config

if TYPE_CHECKING:
    from flask import Flask

__version__ = "0.1.0"

# Flask is imported inside create_app, not at module level, so that
# `import app.domain.sla` does not drag in the web framework. That keeps
# `tests/domain/` genuinely dependency-free — which is the property the whole
# pure-domain design is buying.


def create_app(config: BaseConfig | None = None) -> Flask:
    """Build a configured Flask app.

    Everything is wired here and nowhere else, so a test can build an app with
    an explicit config and get a genuinely isolated instance.
    """
    from flask import Flask

    app = Flask(__name__, instance_relative_config=False)
    settings = config or load_config()
    app.config.from_object(settings)
    app.config["ENV_NAME"] = settings.ENV_NAME

    logging.basicConfig(
        level=logging.DEBUG if app.config.get("DEBUG") else logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    )

    _init_extensions(app)
    _register_api(app)
    _register_cli(app)
    _register_health(app)
    _init_jobs(app)

    return app


def _init_extensions(app: Flask) -> None:
    from app.extensions import db

    db.init_app(app)

    # Importing the models package registers every mapper. Alembic autogenerate
    # and db.create_all() both depend on that having happened.
    import app.models as _models  # noqa: F401

    # The upload directory must exist before the first photo arrives; creating
    # it lazily on the first POST is a race between concurrent uploads.
    app.config["UPLOAD_DIR"].mkdir(parents=True, exist_ok=True)


def _register_api(app: Flask) -> None:
    from app.api import register_blueprints
    from app.core.errors import register_error_handlers

    register_error_handlers(app)
    register_blueprints(app)

    @app.after_request
    def _cors(response):
        """Minimal CORS, so the finished frontend can run with VITE_USE_MOCKS=false.

        Deliberately hand-rolled rather than pulling in Flask-CORS: this API has
        exactly one browser client and one header to allow.
        """
        from flask import request

        origin = request.headers.get("Origin")
        if origin and origin in app.config["CORS_ORIGINS"]:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            response.headers["Access-Control-Allow-Methods"] = (
                "GET, POST, PATCH, DELETE, OPTIONS"
            )
        return response


def _register_health(app: Flask) -> None:
    from flask import jsonify

    @app.get("/health")
    def health():
        """Liveness check.

        Deliberately OUTSIDE the /api/v1 prefix: it is not in openapi.yaml, and
        the contract tests validate every path under that prefix against the
        contract. An undocumented endpoint living there would be a contract
        violation on its own.
        """
        return jsonify(
            {
                "status": "ok",
                "version": __version__,
                "env": app.config["ENV_NAME"],
                "apiPrefix": API_PREFIX,
            }
        )


def _register_cli(app: Flask) -> None:
    from app.seed import seed_command

    app.cli.add_command(seed_command)


def _init_jobs(app: Flask) -> None:
    from app.jobs.scheduler import init_scheduler

    init_scheduler(app)
