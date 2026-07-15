# -*- coding: utf-8 -*-
"""fix_orphan_livreur_carrier_state

Data repair: several carrier-parcel-creation endpoints (the standalone
/api/noest/parcels and /api/yalidine/parcels proxies, and the ZR Express
push-order endpoint) set Order.tracking_number without ever clearing
Order.livreur_id, unlike the main /orders/{id}/dispatch endpoint. This left
orders in an inconsistent state: BOTH an active carrier shipment (tracking
number) AND an internal driver assignment (livreur_id) at the same time —
violating the "exactly one active delivery method" invariant, and causing
those orders to appear in the driver's own dashboard even though the
confirmatrice's interface never reflected an internal-delivery assignment
for them (the carrier tracking is what actually happened).

This migration clears livreur_id on every order that already has a
tracking_number, and logs one audit-trail event per repaired order so the
change is traceable. The application code paths that caused this have
already been fixed to prevent it from recurring.

Idempotent (a no-op on re-run) and non-destructive (only clears livreur_id,
never touches tracking_number, status, or any other field).

Revision ID: w0x1y2z3a4b5
Revises: v9w0x1y2z3a4
Create Date: 2026-07-06
"""

import uuid

from alembic import op
import sqlalchemy as sa

revision = 'w0x1y2z3a4b5'
down_revision = 'v9w0x1y2z3a4'
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
