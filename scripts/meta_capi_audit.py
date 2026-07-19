"""
Meta CAPI / ERP Consistency Audit — read-only diagnostic.
============================================================================
Computes, for a given store and period:
  - real orders (ERP truth)
  - orders eligible for a Purchase send
  - Purchase actually sent successfully
  - Purchase never attempted at all (silently lost)
  - Purchase sent more than once (potential double-count)
  - MERGED orders that still have a successful Purchase (THE core bug:
    Meta counted a conversion for a submission that no longer exists as
    its own order in the ERP)
  - cancelled orders with a Purchase already sent (candidates for a future
    Refund/Adjustment event — not fixed by this script, just surfaced)
  - permanently failed sends (dead letters)
  - orphan CAPI rows with no order_id (the pre-fix browser-relay blind spot)

Same logic as scripts/meta_capi_audit.sql, expressed in SQLAlchemy so it can
be run as part of a CI/ops check, output as JSON, or diffed over time.
Purely read-only — every query is a SELECT, nothing here writes to any
table or calls Meta's API.

Usage
-----
    cd backend
    python scripts/meta_capi_audit.py --store-id <id> [--since 2026-01-01] [--until 2026-07-19] [--json]

Safety
------
- Zero writes. Zero network calls to Meta. Safe to run against production
  at any time, as often as needed.
- Connects to whatever app.core.config.settings.DATABASE_URL resolves to —
  double-check your environment before running against production.
"""
import argparse
import json
import sys
import os
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Windows terminals often default to a cp1252 stdout that can't encode the
# unicode symbols used in the report output below — force UTF-8 so this
# script behaves the same on Windows, macOS, and Linux instead of crashing
# mid-report on the summary line.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

from sqlalchemy import text
from app.db.session import SessionLocal


@dataclass
class AuditResult:
    store_id: str
    since: str
    until: str
    erp_real_orders: int
    erp_eligible_orders: int
    meta_purchase_sent_success: int
    erp_orders_never_sent: int
    meta_purchase_sent_twice_or_more: int
    meta_overcounted_via_merged_duplicates: int
    cancelled_after_purchase_sent: int
    permanently_failed: int
    stuck_in_flight: int
    orphan_purchase_rows_no_order_id: int
    meta_purchase_still_valid: int
    remaining_unexplained_gap: int


_ELIGIBLE_ORDER_FILTER = """
    o.store_id = :store_id
    AND o.created_at BETWEEN :since AND :until
    AND o.is_deleted = false
    AND o.status != 'MERGED'
    AND (o.source IS NULL OR upper(o.source) NOT IN ('MANUAL', 'POS'))
    AND (o.is_abandoned_cart = false OR o.status IN ('CONFIRMED', 'SHIPPED', 'DELIVERED'))
"""


def run_audit(store_id: str, since: str, until: str) -> AuditResult:
    db = SessionLocal()
    try:
        real_orders = db.execute(text("""
            SELECT count(*) FROM orders
            WHERE store_id = :store_id AND created_at BETWEEN :since AND :until
              AND is_deleted = false AND status != 'MERGED'
        """), {"store_id": store_id, "since": since, "until": until}).scalar() or 0

        eligible_orders = db.execute(text(f"""
            SELECT count(*) FROM orders o WHERE {_ELIGIBLE_ORDER_FILTER}
        """), {"store_id": store_id, "since": since, "until": until}).scalar() or 0

        sent_success = db.execute(text("""
            SELECT count(*) FROM meta_capi_logs
            WHERE store_id = :store_id AND event_name = 'Purchase' AND status = 'success'
              AND created_at BETWEEN :since AND :until
        """), {"store_id": store_id, "since": since, "until": until}).scalar() or 0

        never_sent = db.execute(text(f"""
            SELECT count(*) FROM orders o
            WHERE {_ELIGIBLE_ORDER_FILTER}
              AND NOT EXISTS (
                  SELECT 1 FROM meta_capi_logs l
                  WHERE l.order_id = o.id AND l.event_name = 'Purchase'
              )
        """), {"store_id": store_id, "since": since, "until": until}).scalar() or 0

        sent_twice = db.execute(text("""
            SELECT count(*) FROM (
                SELECT order_id FROM meta_capi_logs
                WHERE store_id = :store_id AND event_name = 'Purchase'
                  AND created_at BETWEEN :since AND :until
                GROUP BY order_id HAVING count(*) > 1
            ) x
        """), {"store_id": store_id, "since": since, "until": until}).scalar() or 0

        merged_with_purchase = db.execute(text("""
            SELECT count(*) FROM orders o
            JOIN meta_capi_logs l ON l.order_id = o.id AND l.event_name = 'Purchase' AND l.status = 'success'
            WHERE o.store_id = :store_id AND o.created_at BETWEEN :since AND :until
              AND o.status = 'MERGED'
        """), {"store_id": store_id, "since": since, "until": until}).scalar() or 0

        cancelled_after_sent = db.execute(text("""
            SELECT count(*) FROM orders o
            JOIN meta_capi_logs l ON l.order_id = o.id AND l.event_name = 'Purchase' AND l.status = 'success'
            WHERE o.store_id = :store_id AND o.created_at BETWEEN :since AND :until
              AND o.status = 'CANCELLED'
        """), {"store_id": store_id, "since": since, "until": until}).scalar() or 0

        failed = db.execute(text("""
            SELECT count(*) FROM meta_capi_logs
            WHERE store_id = :store_id AND event_name = 'Purchase' AND status = 'failed'
              AND created_at BETWEEN :since AND :until
        """), {"store_id": store_id, "since": since, "until": until}).scalar() or 0

        stuck = db.execute(text("""
            SELECT count(*) FROM meta_capi_logs
            WHERE store_id = :store_id AND event_name = 'Purchase'
              AND status IN ('queued', 'processing', 'retry', 'pending_retry')
              AND created_at BETWEEN :since AND :until
        """), {"store_id": store_id, "since": since, "until": until}).scalar() or 0

        orphan = db.execute(text("""
            SELECT count(*) FROM meta_capi_logs
            WHERE store_id = :store_id AND event_name = 'Purchase' AND order_id IS NULL
              AND created_at BETWEEN :since AND :until
        """), {"store_id": store_id, "since": since, "until": until}).scalar() or 0

        still_valid = sent_success - merged_with_purchase
        gap = real_orders - still_valid

        return AuditResult(
            store_id=store_id, since=since, until=until,
            erp_real_orders=real_orders,
            erp_eligible_orders=eligible_orders,
            meta_purchase_sent_success=sent_success,
            erp_orders_never_sent=never_sent,
            meta_purchase_sent_twice_or_more=sent_twice,
            meta_overcounted_via_merged_duplicates=merged_with_purchase,
            cancelled_after_purchase_sent=cancelled_after_sent,
            permanently_failed=failed,
            stuck_in_flight=stuck,
            orphan_purchase_rows_no_order_id=orphan,
            meta_purchase_still_valid=still_valid,
            remaining_unexplained_gap=gap,
        )
    finally:
        db.close()


def print_human(result: AuditResult) -> None:
    print(f"\n=== Meta CAPI / ERP Consistency Audit ===")
    print(f"Store: {result.store_id}")
    print(f"Period: {result.since} -> {result.until}\n")
    print(f"{'ERP — real orders (not MERGED, not deleted)':<55} {result.erp_real_orders:>8}")
    print(f"{'ERP — eligible for a Purchase send':<55} {result.erp_eligible_orders:>8}")
    print(f"{'Meta — Purchase sent successfully':<55} {result.meta_purchase_sent_success:>8}")
    print("-" * 65)
    print(f"{'  never sent (silently lost)':<55} {result.erp_orders_never_sent:>8}")
    print(f"{'  sent 2+ times (potential double-count)':<55} {result.meta_purchase_sent_twice_or_more:>8}")
    print(f"{'  overcounted via MERGED duplicates (THE core bug)':<55} {result.meta_overcounted_via_merged_duplicates:>8}")
    print(f"{'  cancelled after Purchase already sent':<55} {result.cancelled_after_purchase_sent:>8}")
    print(f"{'  permanently failed (dead letter)':<55} {result.permanently_failed:>8}")
    print(f"{'  stuck in flight (queued/processing/retry)':<55} {result.stuck_in_flight:>8}")
    print(f"{'  orphan rows, no order_id (pre-fix relay blind spot)':<55} {result.orphan_purchase_rows_no_order_id:>8}")
    print("-" * 65)
    print(f"{'Meta — Purchase STILL VALID (sent - merged-away)':<55} {result.meta_purchase_still_valid:>8}")
    print(f"{'REMAINING UNEXPLAINED GAP (erp_real - meta_still_valid)':<55} {result.remaining_unexplained_gap:>8}")
    if result.remaining_unexplained_gap == 0:
        print("\n✓ Fully reconciled — every ERP order is accounted for.")
    else:
        print(
            f"\n⚠ {abs(result.remaining_unexplained_gap)} order(s) unexplained by the categories above — "
            "widen --since or investigate individually (see meta_capi_audit.sql sections 4/6/8 for the exact rows)."
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Meta CAPI / ERP consistency audit (read-only).")
    parser.add_argument("--store-id", required=True)
    parser.add_argument("--since", default="2020-01-01")
    parser.add_argument("--until", default=datetime.now(timezone.utc).strftime("%Y-%m-%d 23:59:59"))
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON instead of a human report.")
    args = parser.parse_args()

    result = run_audit(args.store_id, args.since, args.until)
    if args.json:
        print(json.dumps(asdict(result), indent=2))
    else:
        print_human(result)


if __name__ == "__main__":
    main()
