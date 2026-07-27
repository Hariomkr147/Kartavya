"""Request models for the officer endpoints.

TODO(phase 4/5) — the models this package needs:

  * EvidenceReviewRequest    — `verdict` (EvidenceVerdict), `reason`. The reason
                               is mandatory for NEEDS_MORE_EVIDENCE and
                               REJECTED; enforce that in `domain.lifecycle`, not
                               here, so the batch door gets the same rule.
  * StatusUpdateRequest      — `status` constrained to the five
                               OfficerTargetStatus values, plus optional
                               `reason` and `note`. Anything outside those five
                               is a SCHEMA-level 400, not a 409 — every other
                               status has its own dedicated door.
  * BatchStatusUpdateRequest — `status`, plus EXACTLY ONE of `complaintIds`
                               (max 100) or `clusterId`. The contract expresses
                               that as `oneOf`; a pydantic `model_validator`
                               reproduces it, so both-or-neither is a 400 before
                               the service ever runs.
  * ProgressNoteRequest      — `note`, max 500 characters.
  * OfficerQueueQuery        — the standard filter/sort/page set. No `zoneId`:
                               an officer's zone comes from their account, never
                               from a query parameter they could edit.

Use `model_config = ConfigDict(extra="forbid")` on each.
"""

from __future__ import annotations
