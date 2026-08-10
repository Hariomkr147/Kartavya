"""Every list query must render as valid SQL on Postgres, not just SQLite.

The test suite runs on SQLite; production runs on Postgres. Nothing else in the
suite can see the difference, which is how `julianday()` — a SQLite-only
function — reached production and made the officer queue answer 500 on every
request (it is the default `URGENCY` sort, so no client input was needed to
trigger it).

Compiling a statement against a dialect needs no server and no driver, so this
runs anywhere the rest of the suite does.
"""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.dialects import postgresql, sqlite

from app.domain.enums import SlaLabel
from app.models import Complaint
from app.services.queries import URGENCY, apply_filters, apply_sort, sla_ratio_expression

NOW = datetime(2026, 8, 10, 8, 0, 44)

#: Functions SQLite has and Postgres does not. `round` is absent on purpose:
#: it exists on both, but Postgres has no `round(double precision, int)`, so it
#: is checked separately below via the NUMERIC cast.
SQLITE_ONLY_FUNCTIONS = ("julianday", "strftime", "group_concat", "ifnull", "instr", "printf")


def _statements():
    """Every query that touches the SLA clock, keyed by what it serves."""
    return {
        "officer queue default sort": apply_sort(
            select(Complaint.id), sort=None, default=URGENCY, now=NOW
        ),
        "sort=sla": apply_sort(select(Complaint.id), sort="sla", default=URGENCY, now=NOW),
        "sort=-sla": apply_sort(select(Complaint.id), sort="-sla", default=URGENCY, now=NOW),
        "slaLabel=ON_TIME": apply_filters(
            select(Complaint.id), sla_label=SlaLabel.ON_TIME, now=NOW
        ),
        "slaLabel=DELAYED": apply_filters(
            select(Complaint.id), sla_label=SlaLabel.DELAYED, now=NOW
        ),
        "slaLabel=OVERDUE": apply_filters(
            select(Complaint.id), sla_label=SlaLabel.OVERDUE, now=NOW
        ),
        "sla ratio expression": select(sla_ratio_expression(NOW)),
    }


@pytest.mark.parametrize("name", list(_statements()))
def test_no_sqlite_only_functions_reach_postgres(name: str) -> None:
    sql = str(_statements()[name].compile(dialect=postgresql.dialect())).lower()
    for function_name in SQLITE_ONLY_FUNCTIONS:
        assert function_name not in sql, (
            f"{name!r} renders {function_name}() on Postgres, which does not have it"
        )


@pytest.mark.parametrize("name", list(_statements()))
def test_postgres_rounds_a_numeric_not_a_float(name: str) -> None:
    """`round(double precision, int)` does not exist in Postgres — only
    `round(numeric, int)`. Any two-argument round must round a NUMERIC."""
    sql = str(_statements()[name].compile(dialect=postgresql.dialect())).lower()
    if "round(" not in sql:
        return
    assert "round(cast(" in sql, f"{name!r} rounds an uncast value on Postgres"


@pytest.mark.parametrize("name", list(_statements()))
def test_sqlite_still_uses_julianday(name: str) -> None:
    """The Postgres fix must not regress the engine the suite actually runs on."""
    sql = str(_statements()[name].compile(dialect=sqlite.dialect())).lower()
    assert "julianday" in sql, f"{name!r} lost its SQLite rendering"


def test_unknown_dialect_fails_loudly() -> None:
    """A third engine should raise here rather than emit silently wrong SQL."""
    from sqlalchemy.dialects import mysql

    with pytest.raises(NotImplementedError, match="seconds_between"):
        str(select(sla_ratio_expression(NOW)).compile(dialect=mysql.dialect()))
