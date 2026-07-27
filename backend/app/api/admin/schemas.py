"""Request models for the admin endpoints.

TODO(phase 7) — the models this package needs:

  * CreateUserRequest        — role restricted to CITIZEN | OFFICER. There is no
                               way to create an ADMIN through the API, and this
                               model is where that becomes structural rather
                               than a check someone can forget.
  * UpdateUserRequest        — name, displayName, zoneId, isActive.
  * AssignOfficerRequest     — officerId.
  * CreateZoneRequest        — zoneCode, zoneName, centerLat, centerLng.
  * UpdateZoneRequest        — zoneName, centerLat, centerLng, isActive. NOT
                               zoneCode: it is immutable once created.
  * ComplaintOverrideRequest — status, zoneId, and a REQUIRED reason. An
                               override without a recorded reason is an
                               unexplained edit to an audit trail.
  * DisputeReviewRequest     — verdict (DisputeVerdict: UPHELD | REJECTED) and
                               a reason.
  * SlaUpdateRequest         — slaTargetHours, minimum 1.
  * SettingsRequest          — autoCloseTimeoutHours.
  * ExportQuery              — the standard filter set, no pagination.

Use `model_config = ConfigDict(extra="forbid")` on each.
"""

from __future__ import annotations
