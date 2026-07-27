"""READ SIDE + HTTP surface, grouped by AUDIENCE.

Business logic is grouped by what it changes (`app/services/`, by aggregate);
serialization is grouped by who is looking (here, by audience). Those are two
different axes on purpose.

Business rules do not care who is calling — a status transition is legal or
illegal regardless of role. Serialization cares about nothing else: the same
complaint row becomes three different JSON documents depending on whether a
citizen, officer or admin asked for it, and those differences ARE the privacy
policy. Splitting this way means "what can an officer see?" is answered by
opening one folder, and `reporter` appearing outside `admin/` is visibly wrong
in review.

Route functions do no logic: parse input, call ONE service function, hand the
result to a serializer. If a route imports a model, that is a smell. If it
touches `db.session`, that is a bug.
"""

from __future__ import annotations

from flask import Flask

from app.settings import API_PREFIX


def register_blueprints(app: Flask) -> None:
    """Mount every audience package under /api/v1.

    Import order does not matter; URL prefixes are declared on each blueprint.
    """
    from app.api.account.routes import bp as account_bp
    from app.api.admin.routes import bp as admin_bp
    from app.api.auth.routes import bp as auth_bp
    from app.api.citizen.routes import bp as citizen_bp
    from app.api.officer.routes import bp as officer_bp
    from app.api.reference.routes import bp as reference_bp
    from app.api.shared.routes import bp as shared_bp

    for blueprint in (
        auth_bp,
        reference_bp,
        account_bp,
        citizen_bp,
        officer_bp,
        admin_bp,
        shared_bp,
    ):
        app.register_blueprint(blueprint, url_prefix=API_PREFIX)
