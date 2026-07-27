"""Request models for the citizen endpoints.

Mirrored by hand from `components/schemas` in backend/api/openapi.yaml — field
names stay camelCase, because the wire format is the contract's.
`app/api/auth/schemas.py` is the worked example.

TODO(phase 3/6) — the models this package needs:

  * CreateComplaintRequest   — multipart, so parse the FORM fields with a model
                               and handle `photos` separately. `zoneId` and
                               `categoryId` are REQUIRED; `description` is not.
                               `categorySuggestedByMatcher` is recorded exactly
                               as the client reports it and never re-derived.
  * SubmitEvidenceRequest    — multipart: 1-3 photos, optional note.
  * DisputeRequest           — multipart: `reason` (required) AND a photo
                               (required). Both, always.
  * ComplaintListQuery       — page, pageSize, sort, status (REPEATABLE),
                               categoryId, dateFrom, dateTo.
  * FeedQuery                — zoneId (a citizen may only ask for their own),
                               includeResolved (default false), categoryId,
                               sort, page, pageSize.
  * LeaderboardQuery         — zoneId, page, pageSize.

Use `model_config = ConfigDict(extra="forbid")` on each, so a client-side typo
becomes a clean 400 instead of a silently dropped field.
"""

from __future__ import annotations
