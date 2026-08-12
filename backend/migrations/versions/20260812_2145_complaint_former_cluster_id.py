"""complaints.former_cluster_id, and back out terminal complaints from clusters

A complaint that reaches CLOSED / REJECTED / UNRESOLVABLE now leaves its
cluster (see services/complaints/clusters.exit_cluster). `former_cluster_id`
keeps the link the reward guards need — they ask whether a citizen was ever
paid inside a cluster, which is a question about history rather than current
membership.

The data step matters as much as the column: every existing database is full
of terminal complaints still holding a `cluster_id`, and those are exactly the
rows inflating cluster counts and keeping finished clusters on the cluster
pages. Backfilling them is what makes the fix retroactive rather than
"correct from now on".

Revision ID: b41e2d7c9a03
Revises: 598e6114acb8
Create Date: 2026-08-12 21:45:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b41e2d7c9a03"
down_revision: str | None = "598e6114acb8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TERMINAL = ("CLOSED", "REJECTED", "UNRESOLVABLE")


def upgrade() -> None:
    # batch_alter_table because SQLite cannot ADD a column with a foreign key
    # in place — Alembic rebuilds the table instead. Harmless on Postgres.
    with op.batch_alter_table("complaints", schema=None) as batch_op:
        batch_op.add_column(sa.Column("former_cluster_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_complaints_former_cluster_id_complaint_clusters",
            "complaint_clusters",
            ["former_cluster_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # Backfill: move every already-terminal complaint out of its cluster,
    # preserving the link. Written as two statements in this order so an
    # interrupted run can only ever leave rows that still have both — never
    # rows that have lost the cluster id without recording it.
    op.execute(
        sa.text(
            "UPDATE complaints SET former_cluster_id = cluster_id "
            "WHERE cluster_id IS NOT NULL AND former_cluster_id IS NULL "
            f"AND status IN {TERMINAL}"
        )
    )
    op.execute(
        sa.text(
            "UPDATE complaints SET cluster_id = NULL "
            f"WHERE cluster_id IS NOT NULL AND status IN {TERMINAL}"
        )
    )

    op.create_index("ix_complaints_former_cluster_id", "complaints", ["former_cluster_id"])


def downgrade() -> None:
    # Put the members back before dropping the column that remembers them,
    # otherwise the association is gone for good.
    op.execute(
        sa.text(
            "UPDATE complaints SET cluster_id = former_cluster_id "
            "WHERE cluster_id IS NULL AND former_cluster_id IS NOT NULL"
        )
    )
    op.drop_index("ix_complaints_former_cluster_id", table_name="complaints")
    with op.batch_alter_table("complaints", schema=None) as batch_op:
        batch_op.drop_constraint(
            "fk_complaints_former_cluster_id_complaint_clusters", type_="foreignkey"
        )
        batch_op.drop_column("former_cluster_id")
