"""SQLAlchemy ORM — the whole schema, as one shared package.

This is the one package not sliced vertically, and that is deliberate: the 14
tables form a single tightly connected foreign-key graph
(users - zones - complaints - clusters - evidence - ledger - badges). Splitting
them across feature folders buys nothing and costs circular imports and
registry-ordering bugs. Treat the schema as a shared kernel.

`backend/database/schema.dbml` is authoritative for every column name, type,
nullability, index and delete rule. Do not improve on it here — and any change
to it must keep `backend/api/openapi.yaml` in sync, since the two are designed
1:1.

Importing this package registers every model with the declarative registry,
which is what Alembic autogenerate and `db.create_all()` both rely on.
"""

from app.models.accounts import ComplaintCategory, User, Zone
from app.models.complaints import Complaint, ComplaintCluster, ComplaintEvidence
from app.models.gamification import Badge, CitizenBadge, PointsLedger
from app.models.history import ComplaintNote, ComplaintUpvote, StatusHistory
from app.models.system import SETTINGS_ROW_ID, AiZoneReport, AppSettings

__all__ = [
    "SETTINGS_ROW_ID",
    "AiZoneReport",
    "AppSettings",
    "Badge",
    "CitizenBadge",
    "Complaint",
    "ComplaintCategory",
    "ComplaintCluster",
    "ComplaintEvidence",
    "ComplaintNote",
    "ComplaintUpvote",
    "PointsLedger",
    "StatusHistory",
    "User",
    "Zone",
]
