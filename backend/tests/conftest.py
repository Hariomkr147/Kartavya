"""Shared fixtures.

`tests/domain/` must not use any of these — those tests are pure and must keep
running in milliseconds with no database and no app context. That speed is the
entire payoff for keeping `app/domain/` pure, and it evaporates the first time a
domain test asks for the `app` fixture.
"""

from __future__ import annotations

import os

import pytest

os.environ.setdefault("KARTAVYA_ENV", "testing")


@pytest.fixture
def app():
    """A Flask app on an in-memory SQLite database, with the schema created.

    `create_all()` rather than running the migrations: tests should fail because
    the code is wrong, not because a migration is slow. The migrations are
    exercised separately — see migrations/README.md.
    """
    from app import create_app
    from app.extensions import db
    from app.settings import TestingConfig

    application = create_app(TestingConfig())
    with application.app_context():
        db.create_all()
        yield application
        db.session.remove()
        db.drop_all()


@pytest.fixture
def seeded_app(app):
    """The app, plus the mandatory seed data (categories, badges, catch-all zone)."""
    from app.seed import seed_all

    with app.app_context():
        seed_all()
    return app


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def session(app):
    from app.extensions import db

    return db.session


@pytest.fixture
def auth_header(app):
    """Build an Authorization header for a user.

        headers = auth_header(some_user)

    Mints a real token through `core.auth.issue_token`, so the tests exercise
    the same verification path production does.
    """
    from app.core.auth import issue_token

    def _make(user):
        with app.app_context():
            token, _ = issue_token(user)
        return {"Authorization": f"Bearer {token}"}

    return _make
