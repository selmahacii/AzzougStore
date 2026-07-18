# -*- coding: utf-8 -*-
"""enable_rls_meta_ads_ad_insights

CRITICAL SECURITY FIX: meta_ads_ad_insights was the only public table with
Row Level Security disabled while the `anon`/`authenticated` Supabase roles
held full SELECT/INSERT/UPDATE/DELETE/TRUNCATE grants on it (same blanket
grants Supabase applies to every public table). Every other table is
already RLS-enabled with zero policies, which is what actually blocks
PostgREST/anon access (grants alone don't bypass RLS) — this table was the
one gap, fully readable/writable by anyone with the project's public anon
key via the Supabase REST API, with no application auth in front of it.

Safe no-op for the app itself: FastAPI connects as the `postgres` role,
which has BYPASSRLS and is unaffected by RLS either way.

Revision ID: q0r1s2t3u4v5
Revises: p9q0r1s2t3u4
Create Date: 2026-07-18
"""

from alembic import op

revision = 'q0r1s2t3u4v5'
down_revision = 'p9q0r1s2t3u4'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE public.meta_ads_ad_insights ENABLE ROW LEVEL SECURITY")


def downgrade():
    op.execute("ALTER TABLE public.meta_ads_ad_insights DISABLE ROW LEVEL SECURITY")
