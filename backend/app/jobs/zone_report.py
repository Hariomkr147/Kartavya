"""AI zone health reports — fire-and-forget; the matching GET is a poll."""

from __future__ import annotations

import logging

from flask import Flask

logger = logging.getLogger(__name__)


def generate_zone_report(app: Flask, report_id: int) -> None:
    """Fill in a PENDING `ai_zone_reports` row.

    TODO(phase 8).

      * `POST /admin/zones/{id}/ai-report` inserts the row at PENDING, returns
        202 IMMEDIATELY, and submits this job. The request never waits on the
        model.
      * Aggregate the zone's statistics first (`services/analytics/zone.py`) and
        pass NUMBERS to the model — never raw rows, and never anything that
        identifies a reporter.
      * On a result: READY, with summary / trends / hotspots / suggestions and
        `generated_at`.
      * On `None`: FAILED with `ai_available = False` and `generated_at` set.
        The GET still returns 200 with that row — the endpoint does not error
        just because the model was down.
      * Own session, own commit, inside `with app.app_context():`.
    """
    raise NotImplementedError
