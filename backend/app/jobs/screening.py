"""AI photo pre-screening — fire-and-forget, one job per evidence row."""

from __future__ import annotations

import logging

from flask import Flask

logger = logging.getLogger(__name__)


def screen_evidence(app: Flask, evidence_id: int) -> None:
    """Screen one photo and write the result back.

    TODO(phase 8).

      * Submitted on evidence create, re-submission and dispute. A 3-photo
        complaint spawns THREE independent jobs — one slow photo must not hold
        up the other two.
      * ⚠ It must NEVER block the 201. The response goes out with
        `ai_screen_status = PENDING`, and the UI is built to show exactly that.
      * On a result: DONE, plus `ai_matches_category`, `ai_confidence`,
        `ai_note`.
      * On `None` from the provider: UNAVAILABLE. That is not an error path —
        it is a documented outcome the UI renders, and it is how the client
        tells "no result yet" apart from "the model was down".
      * Own session, own commit, inside `with app.app_context():`.
      * ADVISORY ONLY. Never auto-reject a complaint on the model's say-so: a
        rejection costs a real citizen 20 points and a false accusation.
    """
    raise NotImplementedError
