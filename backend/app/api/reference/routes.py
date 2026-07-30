"""Fixed lookup data.

`/categories` and `/zones` are public because the registration form needs them
before anyone has a token. `/zones/suggest` is NOT public despite sitting beside
them — read `security:` in the contract carefully.
"""

from __future__ import annotations

from flask import Blueprint

from app.api.shared.responses import todo  # noqa: F401 — used by other stubs
from app.core.auth import require_auth

bp = Blueprint("reference", __name__)


@bp.get("/categories")
def get_categories():
    """200 Category[]. Public (`security: []`)."""
    from app.extensions import db
    from app.models import ComplaintCategory
    from app.api.shared.serializers import serialize_category

    categories = db.session.scalars(db.select(ComplaintCategory)).all()
    return [serialize_category(c) for c in categories]


@bp.get("/zones")
def get_zones():
    """200 Zone[]. Public (`security: []`).

    The contract says "Returns every zone" with no active-only filter,
    so we return all zones including inactive ones.
    """
    from app.services.accounts import zones
    from app.api.shared.serializers import serialize_zone

    all_zones = zones.list_zones(active_only=False)
    return [serialize_zone(z) for z in all_zones]


@bp.post("/zones/suggest")
@require_auth
def suggest_zone():
    """200 ZoneSuggestionResponse. REQUIRES a token — not public."""
    from flask import request
    from app.services.accounts import zones
    from app.api.shared.serializers import serialize_zone
    from app.domain.errors import ValidationError

    data = request.get_json() or {}
    lat = data.get("latitude")
    lng = data.get("longitude")

    if lat is None or lng is None:
        raise ValidationError("latitude and longitude are required.")

    try:
        lat = float(lat)
        lng = float(lng)
    except (TypeError, ValueError):
        raise ValidationError("latitude and longitude must be numbers.")

    zone = zones.suggest_zone(latitude=lat, longitude=lng)
    if zone is None:
        return {"suggestedZone": None}
    return {"suggestedZone": serialize_zone(zone)}
