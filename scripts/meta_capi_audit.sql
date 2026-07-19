-- ============================================================================
-- Meta CAPI / ERP Consistency Audit
-- ============================================================================
-- Purpose: quantify every category of divergence between the ERP's orders
-- and what was actually sent to (or received by) Meta via CAPI, for a given
-- store and period. Read-only — every query below is a SELECT, nothing
-- writes to any table.
--
-- Usage: replace :store_id and :since / :until below (psql \set, or paste
-- literal values), run section by section in Supabase's SQL editor.
--
-- Root cause already identified and fixed in code (see
-- app/services/order_service.py + orders.py's POST / handler +
-- src/components/storefront/checkout-form.tsx): the storefront used to fire
-- Purchase to Meta (Pixel + CAPI relay) immediately on order creation,
-- BEFORE auto_merge_duplicates had a chance to decide whether the
-- submission was a duplicate. A duplicate that got merged a few seconds/
-- minutes later had already been permanently counted as a Purchase by
-- Meta — the ERP would then show one fewer "real" order than Meta's raw
-- Purchase count. This audit measures the historical extent of that gap
-- and looks for the OTHER categories of divergence (never-sent, sent-twice,
-- lost-to-retry-exhaustion) so nothing is assumed away.
-- ============================================================================

\set store_id '''2c81d28d-a453-4645-a8b7-b79dd32ba6f7'''
\set since '''2026-01-01 00:00:00'''
\set until '''2026-07-19 23:59:59'''


-- ── 1. Real order count (ERP truth) ────────────────────────────────────────
-- Orders that exist as their OWN standalone entity in this period: not
-- deleted, not MERGED into a sibling (a MERGED order isn't a real order
-- anymore — it's absorbed into its parent's basket).
SELECT count(*) AS real_orders
FROM orders
WHERE store_id = :store_id
  AND created_at BETWEEN :since AND :until
  AND is_deleted = false
  AND status != 'MERGED';


-- ── 2. Orders eligible for a Purchase send ──────────────────────────────────
-- Same as #1, minus MANUAL/POS orders (deliberately excluded — no ad click
-- ever happened, sending CAPI for them would inflate Meta's count with
-- sales the platform never influenced) and minus abandoned carts that were
-- never actually confirmed into a real sale.
SELECT count(*) AS eligible_orders
FROM orders
WHERE store_id = :store_id
  AND created_at BETWEEN :since AND :until
  AND is_deleted = false
  AND status != 'MERGED'
  AND (source IS NULL OR upper(source) NOT IN ('MANUAL', 'POS'))
  AND (is_abandoned_cart = false OR status IN ('CONFIRMED', 'SHIPPED', 'DELIVERED'));


-- ── 3. Purchase CAPI rows actually sent successfully ────────────────────────
SELECT count(*) AS purchase_sent_success
FROM meta_capi_logs
WHERE store_id = :store_id
  AND event_name = 'Purchase'
  AND status = 'success'
  AND created_at BETWEEN :since AND :until;


-- ── 4. Eligible orders that NEVER got a Purchase attempt at all ────────────
-- (no meta_capi_logs row whatsoever for this order_id, any status) — these
-- are Purchases silently lost, never even attempted, not just failed.
SELECT o.id, o.order_number, o.status, o.source, o.is_abandoned_cart, o.created_at
FROM orders o
WHERE o.store_id = :store_id
  AND o.created_at BETWEEN :since AND :until
  AND o.is_deleted = false
  AND o.status != 'MERGED'
  AND (o.source IS NULL OR upper(o.source) NOT IN ('MANUAL', 'POS'))
  AND (o.is_abandoned_cart = false OR o.status IN ('CONFIRMED', 'SHIPPED', 'DELIVERED'))
  AND NOT EXISTS (
      SELECT 1 FROM meta_capi_logs l
      WHERE l.order_id = o.id AND l.event_name = 'Purchase'
  )
ORDER BY o.created_at DESC;


-- ── 5. Orders with MORE THAN ONE Purchase CAPI row (potential double-send) ─
-- The unique dedup index on (order_id, event_name) for Purchase should make
-- this structurally impossible for rows created by the current code — any
-- result here is either historical (pre-dating that constraint) or a sign
-- the constraint isn't doing what it's supposed to.
SELECT order_id, count(*) AS purchase_row_count,
       array_agg(status ORDER BY created_at) AS statuses,
       array_agg(id ORDER BY created_at) AS log_ids
FROM meta_capi_logs
WHERE store_id = :store_id
  AND event_name = 'Purchase'
  AND created_at BETWEEN :since AND :until
GROUP BY order_id
HAVING count(*) > 1;


-- ── 6. THE core bug: MERGED orders that still have a successful Purchase ──
-- send. This order no longer exists as a standalone sale in the ERP (it was
-- absorbed into its parent), but Meta was already told about it before the
-- merge happened. This is the exact "Meta counts more than the ERP shows"
-- gap. Cross-references merged_at against the Purchase's own send time so
-- you can see whether the send happened BEFORE or AFTER the merge (before
-- = the bug; after = should not be possible with the current safeguards,
-- worth investigating individually if found).
SELECT
  o.id, o.order_number, o.status, o.parent_order_id, o.merged_at,
  l.created_at AS purchase_sent_at,
  (l.created_at < o.merged_at) AS sent_before_merge
FROM orders o
JOIN meta_capi_logs l
  ON l.order_id = o.id AND l.event_name = 'Purchase' AND l.status = 'success'
WHERE o.store_id = :store_id
  AND o.created_at BETWEEN :since AND :until
  AND o.status = 'MERGED'
ORDER BY o.merged_at DESC;


-- ── 7. Cancelled orders with a successful Purchase already sent ───────────
-- A cancellation after a Purchase was sent is a legitimate case for a
-- Refund/Adjustment event to Meta (not covered by the current pipeline at
-- all) — this count is what a future Refund-event feature would need to
-- backfill, not a bug in the Purchase-send logic itself.
SELECT count(*) AS cancelled_after_purchase_sent
FROM orders o
JOIN meta_capi_logs l
  ON l.order_id = o.id AND l.event_name = 'Purchase' AND l.status = 'success'
WHERE o.store_id = :store_id
  AND o.created_at BETWEEN :since AND :until
  AND o.status = 'CANCELLED';


-- ── 8. Permanently failed sends (retry budget exhausted) ───────────────────
-- Real Purchases that should have been sent but never succeeded — dead
-- letters, still queryable, never silently dropped.
SELECT o.id, o.order_number, o.status, l.error_message, l.error_category,
       l.retry_count, l.completed_at
FROM meta_capi_logs l
JOIN orders o ON o.id = l.order_id
WHERE l.store_id = :store_id
  AND l.event_name = 'Purchase'
  AND l.status = 'failed'
  AND l.created_at BETWEEN :since AND :until
ORDER BY l.completed_at DESC;


-- ── 9. Stuck in-flight (never resolved) ─────────────────────────────────────
-- Rows still 'queued'/'processing'/'retry'/'pending_retry' — either the
-- retry sweep hasn't caught up yet (normal if recent), or something is
-- stuck (worth checking if completed_at is null and created_at is old).
SELECT status, count(*), min(created_at), max(created_at)
FROM meta_capi_logs
WHERE store_id = :store_id
  AND event_name = 'Purchase'
  AND status IN ('queued', 'processing', 'retry', 'pending_retry')
  AND created_at BETWEEN :since AND :until
GROUP BY status;


-- ── 10. Orphan CAPI rows (no order_id) — the browser-relay path ───────────
-- Purchase events sent via the frontend relay (POST /api/v1/meta-ads/events)
-- BEFORE the order_id fix landed this session — these can never be
-- reconciled to a specific order after the fact (order_id was never
-- recorded). Their count is the historical blind spot; going forward, new
-- rows on this path DO carry order_id (see app/api/v1/meta_ads.py's
-- MetaEventPayload.order_id).
SELECT count(*) AS orphan_purchase_capi_rows, min(created_at), max(created_at)
FROM meta_capi_logs
WHERE store_id = :store_id
  AND event_name = 'Purchase'
  AND order_id IS NULL
  AND created_at BETWEEN :since AND :until;


-- ── 11. Summary reconciliation — the single number that matters ───────────
-- real_orders (#1) vs purchase_sent_success (#3) vs
-- (purchase_sent_success - merged_with_purchase (#6 count)) = the actual
-- number of STILL-VALID orders that have a Purchase Meta still counts.
-- If this last number is meaningfully below real_orders, #4 (never sent)
-- and #8 (failed) explain the remaining gap.
WITH real_orders AS (
  SELECT count(*) AS n FROM orders
  WHERE store_id = :store_id AND created_at BETWEEN :since AND :until
    AND is_deleted = false AND status != 'MERGED'
),
sent AS (
  SELECT count(*) AS n FROM meta_capi_logs
  WHERE store_id = :store_id AND event_name = 'Purchase' AND status = 'success'
    AND created_at BETWEEN :since AND :until
),
merged_with_purchase AS (
  SELECT count(*) AS n FROM orders o
  JOIN meta_capi_logs l ON l.order_id = o.id AND l.event_name = 'Purchase' AND l.status = 'success'
  WHERE o.store_id = :store_id AND o.created_at BETWEEN :since AND :until AND o.status = 'MERGED'
),
never_sent AS (
  SELECT count(*) AS n FROM orders o
  WHERE o.store_id = :store_id AND o.created_at BETWEEN :since AND :until
    AND o.is_deleted = false AND o.status != 'MERGED'
    AND (o.source IS NULL OR upper(o.source) NOT IN ('MANUAL', 'POS'))
    AND (o.is_abandoned_cart = false OR o.status IN ('CONFIRMED', 'SHIPPED', 'DELIVERED'))
    AND NOT EXISTS (SELECT 1 FROM meta_capi_logs l WHERE l.order_id = o.id AND l.event_name = 'Purchase')
),
failed AS (
  SELECT count(*) AS n FROM meta_capi_logs
  WHERE store_id = :store_id AND event_name = 'Purchase' AND status = 'failed'
    AND created_at BETWEEN :since AND :until
)
SELECT
  (SELECT n FROM real_orders) AS erp_real_orders,
  (SELECT n FROM sent) AS meta_purchase_received,
  (SELECT n FROM merged_with_purchase) AS meta_overcounted_via_merged_duplicates,
  (SELECT n FROM never_sent) AS erp_orders_never_sent_to_meta,
  (SELECT n FROM failed) AS erp_orders_permanently_failed,
  (SELECT n FROM sent) - (SELECT n FROM merged_with_purchase) AS meta_purchase_still_valid,
  (SELECT n FROM real_orders) - ((SELECT n FROM sent) - (SELECT n FROM merged_with_purchase)) AS remaining_unexplained_gap;
