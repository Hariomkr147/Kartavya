"""users.mfa_method, users.mfa_secret_enc, users.google_sub

Two-step verification (TOTP first, more methods later) and Google Sign-In.
Everything is nullable, so every existing row is valid as it stands: no
backfill, and a user with all three NULL logs in exactly as before.

Deliberately NOT `batch_alter_table`. Most tables reference `users`, and on
SQLite a batch rebuild copies and drops the table underneath those foreign
keys. Plain `ALTER TABLE ... ADD COLUMN` is enough here: SQLite adds a nullable
column in place, and Postgres does the same.

The CHECK on `mfa_method` is written as raw SQL for the same reason. Alembic's
`add_column` skips an Enum's implicit CHECK on SQLite (it warns and moves on),
which would leave the column unguarded in exactly the database where a typo is
easiest to store. The constraint name matches what the `ck_` naming convention
produces for `create_all()`, so the two paths agree.

Revision ID: 7c3f1a9e5b20
Revises: b41e2d7c9a03
Create Date: 2026-09-29 15:00:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7c3f1a9e5b20"
down_revision: str | None = "b41e2d7c9a03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN mfa_method VARCHAR(40) "
        "CONSTRAINT ck_users_mfa_method CHECK (mfa_method IN ('TOTP'))"
    )
    op.add_column("users", sa.Column("mfa_secret_enc", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("google_sub", sa.String(length=255), nullable=True))
    op.create_index("ux_users_google_sub", "users", ["google_sub"], unique=True)


def downgrade() -> None:
    # SQLite can DROP COLUMN in place from 3.35. Older builds cannot; Render's
    # Python 3.12 image and every current Postgres can.
    op.drop_index("ux_users_google_sub", table_name="users")
    op.drop_column("users", "google_sub")
    op.drop_column("users", "mfa_secret_enc")
    op.drop_column("users", "mfa_method")
