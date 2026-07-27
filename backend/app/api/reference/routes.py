"""Fixed lookup data.

`/categories` and `/zones` are public because the registration form needs them
before anyone has a token. `/zones/suggest` is NOT public despite sitting beside
them — read `security:` in the contract carefully.
"""

from __future__ import annotations

from flask import Blueprint

from app.api.shared.responses import todo
from app.core.auth import require_auth

bp = Blueprint("reference", __name__)


@bp.get("/categories")
def get_categories():
    """200 Category[]. Public (`security: []`).

    TODO(phase 2). The 12 seeded categories. Field renames to watch:
    `category_code` -> `code`, `sla_hours` -> `slaTargetHours`.

    `code` is the key `frontend/src/lib/categoryMatcher.ts` writes its offline
    keyword lexicon against, so it must never change in place.
    """
    todo("Category list")


@bp.get("/zones")
def get_zones():
    """200 Zone[]. Public (`security: []`).

    TODO(phase 2). Public so the registration form can offer a home zone.
    """
    todo("Zone list")


@bp.post("/zones/suggest")
@require_auth
def suggest_zone():
    """200 ZoneSuggestionResponse. REQUIRES a token — not public.

    TODO(phase 2). Nearest ACTIVE zone to a lat/lng, via
    `domain.geo.nearest_active_zone`. The client calls this with photo EXIF GPS
    to pre-fill the complaint form; the citizen still confirms the choice, and
    `CreateComplaintRequest.zoneId` is what actually gets stored.
    """
    todo("Zone suggestion")
