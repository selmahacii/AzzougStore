# -*- coding: utf-8 -*-
"""retry_orphan_livreur_repair

The previous migration (w0x1y2z3a4b5) crashed on production before making
any change: it inserted into order_events without supplying `updated_at`,
which is NOT NULL (inherited from Base, no server-side default). The
startup script auto-stamped that revision as applied after the failure, so
alembic will never retry it — this migration performs the actual repair
with the fix applied.

Same operation as before: clear Order.livreur_id wherever a tracking_number
is already set (a carrier parcel and an internal driver can never both be
active), with one traceability event per repaired order.

Idempotent (no-op if nothing matches) and safe to run on a database where
the previous migration already succeeded (finds zero rows, does nothing).

Revision ID: x1y2z3a4b5c6
Revises: w0x1y2z3a4b5
Create Date: 2026-07-06
"""

import uuid

from alembic import op
import sqlalchemy as sa

revision = 'x1y2z3a4b5c6'
down_revision = 'w0x1y2z3a4b5'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    affected = conn.execute(sa.text(
        "SELECT id, order_number, status FROM orders "
        "WHERE tracking_number IS NOT NULL AND tracking_number != '' "
        "AND livreur_id IS NOT NULL"
    )).fetchall()

    if not affected:
        return

    note = (
        "Correction automatique : cette commande avait un colis transporteur ET un "
        "livreur interne assignés simultanément (état incohérent hérité d'un bug de "
        "dispatch). Le livreur interne a été retiré — le transporteur reste la "
        "méthode de livraison active."
    )
    for row in affected:
        conn.execute(
            sa.text(
                "INSERT INTO order_events (id, order_id, from_status, to_status, note, call_attempt, created_at, updated_at) "
                "VALUES (:id, :order_id, :status, :status, :note, 1, now(), now())"
            ),
            {"id": str(uuid.uuid4()), "order_id": row.id, "status": row.status, "note": note},
        )

    conn.execute(sa.text(
        "UPDATE orders SET livreur_id = NULL "
        "WHERE tracking_number IS NOT NULL AND tracking_number != '' AND livreur_id IS NOT NULL"
    ))


def downgrade():
    # Not reversible: the original (incorrect) livreur_id values are not preserved.
    pass
