"""Fixed lookup data.

``/categories`` and ``/zones`` are public because the registration form needs
them before anyone has a token.  ``/zones/suggest`` is NOT public despite
sitting beside them — read ``security:`` in the contract carefully.
"""

from __future__ import annotations

from flask import Blueprint

from pydantic import BaseModel, ConfigDict

from app.api.shared.responses import todo  # noqa: F401 — used by other stubs
from app.core.auth import require_auth
from app.core.validation import validate_body

class ZoneSuggestionRequest(BaseModel):
    """openapi.yaml: ZoneSuggestionRequest."""

    model_config = ConfigDict(extra="forbid")

    latitude: float
    longitude: float

bp = Blueprint("reference", __name__)


@bp.get("/categories")
def get_categories():
    """200 Category[]. Public (``security: []``)."""
    from app.api.shared.serializers import serialize_category
    from app.services.accounts import settings

    return [serialize_category(c) for c in settings.list_categories()]


@bp.get("/zones")
def get_zones():
    """200 Zone[]. Public (``security: []``).

    The contract says "Returns every zone" with no active-only filter,
    so we return all zones including inactive ones.
    """
    from app.api.shared.serializers import serialize_zone
    from app.services.accounts import zones

    all_zones = zones.list_zones(active_only=False)
    return [serialize_zone(z) for z in all_zones]


@bp.post("/zones/suggest")
@require_auth
@validate_body(ZoneSuggestionRequest)
def suggest_zone(body: ZoneSuggestionRequest):
    """200 ZoneSuggestionResponse. REQUIRES a token — not public."""
    from app.api.shared.serializers import serialize_zone
    from app.services.accounts import zones

    zone = zones.suggest_zone(latitude=body.latitude, longitude=body.longitude)
    if zone is None:
        return {"suggestedZone": None}
    return {"suggestedZone": serialize_zone(zone)}
