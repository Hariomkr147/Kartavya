"""The auto-close sweeper.

⚠ THIS IS THE ONE REQUIREMENT WITH NO FRONTEND REFERENCE IMPLEMENTATION.

A browser cannot run a scheduler, so `frontend/src/mocks/` simply does not have
it. There is no TypeScript to port and nothing will remind you it is missing —
and it is also among the easiest requirements in the spec to forget entirely.
Do not leave it to the end of phase 8.
"""

from __future__ import annotations

import logging

from flask import Flask

logger = logging.getLogger(__name__)


def sweep_auto_close(app: Flask) -> int:
    """Close RESOLVED complaints whose confirmation window has elapsed.

    TODO(phase 8). Returns how many were closed.

    Rules:
      * Re-read `app_settings.auto_close_timeout_hours` ON EVERY RUN. It is a
        LIVE rule, not a per-complaint deadline: lowering it can close a backlog
        on the very next pass, and raising it hands time back to complaints
        already waiting. Nothing already CLOSED is ever reopened.
      * The predicate is `status = RESOLVED AND resolved_at + timeout <= now`.
      * Go through `services.complaints.lifecycle.auto_close(...)`, so each
        close gets a proper `status_history` row with actor_role=SYSTEM and
        changed_by_user_id=NULL — SYSTEM transitions are audited like every
        other kind.
      * ZERO POINTS. Rewards flow only through an explicit citizen confirm; do
        not call the gamification services from here.
      * Open this job's OWN session and commit it. Never reuse a request-scoped
        session in a scheduler thread.
      * Idempotent and re-entrant: a second pass over the same rows must be a
        no-op, and the guarded UPDATE already makes it one.

    Needs an app context (`with app.app_context():`) — the scheduler thread has
    none of its own.
    """
    raise NotImplementedError
