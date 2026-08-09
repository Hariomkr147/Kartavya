"""Cover the DATABASE_URL normalisation that makes a hosted Postgres URL work as-is.

Both failure modes this guards against present as an unbootable deployment
rather than a URL problem, so they are worth pinning down:

  * `postgres://` — still handed out by several providers; SQLAlchemy 2 dropped
    the alias and raises "Can't load plugin: sqlalchemy.dialects:postgres".
  * bare `postgresql://` — selects psycopg2, which this project does not
    install. It ships psycopg 3, so the driver has to be named explicitly.
"""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine

from app.settings import normalize_database_url


@pytest.mark.parametrize(
    "given",
    [
        "postgres://u:p@ep-x.aws.neon.tech/neondb?sslmode=require",
        "postgresql://u:p@ep-x.aws.neon.tech/neondb?sslmode=require",
    ],
)
def test_hosted_postgres_urls_gain_the_psycopg_driver(given: str) -> None:
    normalized = normalize_database_url(given)
    assert normalized.startswith("postgresql+psycopg://")
    # Credentials, host, database and query string must survive untouched —
    # dropping `sslmode=require` would break the connection to Neon.
    assert normalized.endswith("u:p@ep-x.aws.neon.tech/neondb?sslmode=require")


@pytest.mark.parametrize(
    "given",
    [
        "postgresql+psycopg://u:p@host/db",
        "postgresql+psycopg2://u:p@host/db",
        "sqlite:///instance/kartavya.sqlite3",
        "sqlite://",
    ],
)
def test_explicit_drivers_and_sqlite_are_left_alone(given: str) -> None:
    assert normalize_database_url(given) == given


def test_normalized_url_resolves_to_a_real_dialect_and_driver() -> None:
    """The point of the rewrite: SQLAlchemy must be able to build the engine.

    `create_engine` resolves the dialect and imports the DBAPI without opening
    a connection, so this asserts the driver is genuinely installed rather than
    just that the string looks right.
    """
    engine = create_engine(
        normalize_database_url("postgres://u:p@ep-x.aws.neon.tech/neondb?sslmode=require")
    )
    assert engine.dialect.name == "postgresql"
    assert engine.dialect.driver == "psycopg"
