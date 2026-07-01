"""add prod_* production fields to products table

Revision ID: h4i5j6k7l8m9
Revises: g3h4i5j6k7l8
Branch_labels: None
Depends_on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'h4i5j6k7l8m9'
down_revision = 'g3h4i5j6k7l8'
branch_labels = None
depends_on = None


_COLUMNS = [
    ("production_source",           "VARCHAR DEFAULT 'imported'"),
    ("prod_supplier_name",          "VARCHAR"),
    ("prod_batch_qty",              "INTEGER DEFAULT 1"),
    ("prod_fabric_cost",            "INTEGER DEFAULT 0"),
    ("prod_fabric_supplier",        "VARCHAR"),
    ("prod_accessories_cost",       "INTEGER DEFAULT 0"),
    ("prod_accessories_supplier",   "VARCHAR"),
    ("prod_labor_cut_cost",         "INTEGER DEFAULT 0"),
    ("prod_labor_cut_supplier",     "VARCHAR"),
    ("prod_labor_sew_cost",         "INTEGER DEFAULT 0"),
    ("prod_labor_sew_supplier",     "VARCHAR"),
    ("prod_labor_finish_cost",      "INTEGER DEFAULT 0"),
    ("prod_labor_finish_supplier",  "VARCHAR"),
    ("prod_packaging_cost",         "INTEGER DEFAULT 0"),
    ("prod_packaging_supplier",     "VARCHAR"),
    ("prod_transport_cost",         "INTEGER DEFAULT 0"),
    ("prod_transport_supplier",     "VARCHAR"),
    ("prod_other_cost",             "INTEGER DEFAULT 0"),
    ("prod_other_supplier",         "VARCHAR"),
    ("prod_notes",                  "VARCHAR"),
    ("allowed_carriers",            "JSON DEFAULT '[]'::json"),
]


def upgrade() -> None:
    conn = op.get_bind()
    for col_name, col_def in _COLUMNS:
        result = conn.execute(sa.text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
            "WHERE table_name='products' AND column_name=:col)"
        ), {"col": col_name})
        if not result.scalar():
            conn.execute(sa.text(
                f"ALTER TABLE products ADD COLUMN {col_name} {col_def}"
            ))


def downgrade() -> None:
    for col_name, _ in _COLUMNS:
        op.drop_column('products', col_name)
