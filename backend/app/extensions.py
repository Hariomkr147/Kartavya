"""Extension singletons, created unbound and initialised in create_app().

Kept in their own module so `app/models/` can import `db` without importing the
application factory — which would be circular.
"""

from __future__ import annotations

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

#: Explicit constraint naming. SQLite cannot ALTER a constraint into existence
#: after the fact, so Alembic needs every constraint to have a predictable name
#: from the very first migration.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Declarative base for every model. Mixins live in app/models/base.py."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


db = SQLAlchemy(model_class=Base)
