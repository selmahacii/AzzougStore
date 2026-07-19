"""
Meta CAPI / ERP Repair — plan first, execute only on explicit confirmation.
============================================================================
Builds on scripts/meta_capi_audit.py's categories and proposes SAFE,
non-duplicating corrective actions for exactly two of them:

  A) Orders eligible for a Purchase that were NEVER attempted at all
     (no meta_capi_logs row for this order_id) — safe to send for the
     first time, PROVIDED the order is within Meta's accepted event_time
     window (Meta rejects event_time older than 7 days — see
     app.services.meta_capi.build_purchase_event's own docstring). Orders
     older than that are listed but never auto-resent: Meta would reject
     them, and re-attempting endlessly would just churn the retry queue.

  B) Orders whose Purchase send permanently FAILED (status='failed',
     retry budget exhausted) with a category that suggests the failure
     was transient/environmental (network_timeout, network_error,
     api_5xx) rather than structural (api_4xx — Meta rejected the
     request itself; retrying the same payload will fail the same way).
     Repair here means resetting the EXISTING meta_capi_logs row back to
     'retry' so the normal periodic sweep (retry_pending_events) picks it
     up — never inserting a new row, so the existing unique constraint
     (order_id, event_name) can never be violated and no duplicate can
     ever reach Meta.

Two categories are DELIBERATELY never auto-repaired, always report-only,
regardless of --execute:

  C) Orders that were MERGED after Meta already received their Purchase
     (the root-cause bug's historical damage). There is no safe corrective
     send here — Meta already counted the conversion; nothing in the CAPI
     spec lets you "un-send" it, and creating ANY new event for a MERGED
     order (which structurally isn't a sale anymore) would only add a
     second inflation on top of the first. Human judgment call is required
     for whether/how to communicate this to whoever manages the ad
     account (e.g. accepting the historical numbers as-is, since Meta's
     own attribution windows make backfilling old data unreliable anyway
     — see the caveat this whole plan was built around).

  D) Orders with more than one successful Purchase row (should be
     impossible given the DB unique constraint — if any appear, they
     predate it or reveal a real gap in it, and need investigation before
     any repair logic touches them).

Nothing in this script EVER calls Meta's API directly — it only enqueues
(category A) or resets existing rows (category B) for the SAME periodic
sweep / worker that already exists in production (app.services.meta_capi),
so the actual network send goes through the one code path already proven
safe, not a new one.

Usage
-----
    cd backend
    # Report only — the default, and the ONLY mode that runs without
    # --execute. Always run this first and read it.
    python scripts/meta_capi_repair.py --store-id <id> [--since ...] [--until ...]

    # Actually enqueue category A (within the 7-day window) and reset
    # category B (transient failures) for the normal retry sweep to pick
    # up. Requires explicit confirmation typed at the prompt — never
    # skippable via a flag, on purpose.
    python scripts/meta_capi_repair.py --store-id <id> --execute

Safety
------
- Report mode makes ZERO writes and ZERO network calls.
- --execute still never calls Meta directly; it only writes to
  meta_capi_logs (existing rows for category B, new rows only for
  category A where none exists yet) and relies on the existing durable
  queue/sweep to actually send — same safety guarantees (idempotency,
  retry, dedup) as the normal production flow.
- Categories C and D are NEVER written to, with or without --execute.
- Every action taken is printed before AND after, with the row ids
  affected, for an auditable paper trail.
"""
import argparse
import sys
import os
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# See meta_capi_audit.py's identical guard — Windows' default cp1252 stdout
# can't encode the unicode symbols in this report.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

from sqlalchemy import text
from app.db.session import SessionLocal

META_EVENT_TIME_WINDOW_DAYS = 7  # matches Meta's documented Conversions API acceptance window


_ELIGIBLE_ORDER_FILTER = """
    o.store_id = :store_id
    AND o.created_at BETWEEN :since AND :until
    AND o.is_deleted = false
    AND o.status != 'MERGED'
    AND (o.source IS NULL OR upper(o.source) NOT IN ('MANUAL', 'POS'))
    AND (o.is_abandoned_cart = false OR o.status IN ('CONFIRMED', 'SHIPPED', 'DELIVERED'))
"""

_RETRYABLE_FAILURE_CATEGORIES = ("network_timeout", "network_error", "api_5xx", None)


def find_never_sent(db, store_id: str, since: str, until: str):
    return db.execute(text(f"""
        SELECT o.id, o.order_number, o.created_at, o.store_id
        FROM orders o
        WHERE {_ELIGIBLE_ORDER_FILTER}
          AND NOT EXISTS (
              SELECT 1 FROM meta_capi_logs l
              WHERE l.order_id = o.id AND l.event_name = 'Purchase'
          )
        ORDER BY o.created_at DESC
    """), {"store_id": store_id, "since": since, "until": until}).fetchall()


def find_permanently_failed(db, store_id: str, since: str, until: str):
    return db.execute(text("""
        SELECT l.id AS log_id, o.id AS order_id, o.order_number, l.error_category, l.error_message, l.retry_count
        FROM meta_capi_logs l
        JOIN orders o ON o.id = l.order_id
        WHERE l.store_id = :store_id AND l.event_name = 'Purchase' AND l.status = 'failed'
          AND l.created_at BETWEEN :since AND :until
        ORDER BY l.completed_at DESC
    """), {"store_id": store_id, "since": since, "until": until}).fetchall()


def find_merged_overcounted(db, store_id: str, since: str, until: str):
    return db.execute(text("""
        SELECT o.id, o.order_number, o.parent_order_id, o.merged_at, l.created_at AS purchase_sent_at
        FROM orders o
        JOIN meta_capi_logs l ON l.order_id = o.id AND l.event_name = 'Purchase' AND l.status = 'success'
        WHERE o.store_id = :store_id AND o.created_at BETWEEN :since AND :until AND o.status = 'MERGED'
        ORDER BY o.merged_at DESC
    """), {"store_id": store_id, "since": since, "until": until}).fetchall()


def find_sent_twice(db, store_id: str, since: str, until: str):
    return db.execute(text("""
        SELECT order_id, count(*) AS n, array_agg(id) AS log_ids, array_agg(status) AS statuses
        FROM meta_capi_logs
        WHERE store_id = :store_id AND event_name = 'Purchase' AND created_at BETWEEN :since AND :until
        GROUP BY order_id HAVING count(*) > 1
    """), {"store_id": store_id, "since": since, "until": until}).fetchall()


def build_plan(store_id: str, since: str, until: str) -> dict:
    db = SessionLocal()
    try:
        never_sent = find_never_sent(db, store_id, since, until)
        failed = find_permanently_failed(db, store_id, since, until)
        merged_overcounted = find_merged_overcounted(db, store_id, since, until)
        sent_twice = find_sent_twice(db, store_id, since, until)

        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=META_EVENT_TIME_WINDOW_DAYS)
        never_sent_resendable = [r for r in never_sent if r.created_at >= cutoff]
        never_sent_too_old = [r for r in never_sent if r.created_at < cutoff]

        failed_retryable = [r for r in failed if r.error_category in _RETRYABLE_FAILURE_CATEGORIES]
        failed_needs_human_review = [r for r in failed if r.error_category not in _RETRYABLE_FAILURE_CATEGORIES]

        return {
            "never_sent_resendable": never_sent_resendable,
            "never_sent_too_old": never_sent_too_old,
            "failed_retryable": failed_retryable,
            "failed_needs_human_review": failed_needs_human_review,
            "merged_overcounted": merged_overcounted,  # never touched
            "sent_twice": sent_twice,  # never touched
        }
    finally:
        db.close()


def print_plan(plan: dict) -> None:
    print("\n=== Meta CAPI Repair Plan ===\n")

    print(f"[A] Never sent, WITHIN {META_EVENT_TIME_WINDOW_DAYS}-day window — safe to resend: {len(plan['never_sent_resendable'])}")
    for r in plan["never_sent_resendable"]:
        print(f"    {r.order_number}  ({r.id})  created_at={r.created_at}")

    print(f"\n[A] Never sent, OLDER than {META_EVENT_TIME_WINDOW_DAYS} days — Meta will reject, NOT auto-resendable: {len(plan['never_sent_too_old'])}")
    for r in plan["never_sent_too_old"]:
        print(f"    {r.order_number}  ({r.id})  created_at={r.created_at}")

    print(f"\n[B] Permanently failed, transient category — safe to reset for retry: {len(plan['failed_retryable'])}")
    for r in plan["failed_retryable"]:
        print(f"    {r.order_number}  (log={r.log_id})  category={r.error_category}  attempts={r.retry_count}  error={r.error_message}")

    print(f"\n[B] Permanently failed, structural (api_4xx) — needs human review, not auto-retried: {len(plan['failed_needs_human_review'])}")
    for r in plan["failed_needs_human_review"]:
        print(f"    {r.order_number}  (log={r.log_id})  category={r.error_category}  error={r.error_message}")

    print(f"\n[C] MERGED orders that already have a successful Purchase — NO safe automated repair exists, informational only: {len(plan['merged_overcounted'])}")
    for r in plan["merged_overcounted"]:
        sent_before_merge = r.purchase_sent_at < r.merged_at if r.merged_at else None
        print(f"    order={r.order_number}  merged_at={r.merged_at}  purchase_sent_at={r.purchase_sent_at}  sent_before_merge={sent_before_merge}")

    print(f"\n[D] Sent 2+ times — needs individual investigation, never auto-touched: {len(plan['sent_twice'])}")
    for r in plan["sent_twice"]:
        print(f"    order_id={r.order_id}  count={r.n}  log_ids={r.log_ids}  statuses={r.statuses}")

    print(
        f"\nSummary: {len(plan['never_sent_resendable'])} resendable now, "
        f"{len(plan['failed_retryable'])} retryable now, "
        f"{len(plan['never_sent_too_old']) + len(plan['failed_needs_human_review'])} need human review, "
        f"{len(plan['merged_overcounted']) + len(plan['sent_twice'])} have no automated fix."
    )


def execute_plan(plan: dict, store_id: str) -> None:
    from app.models.order import Order
    from app.models.marketing import MetaCapiLog
    from app.services.meta_capi import enqueue_purchase_for_order

    db = SessionLocal()
    enqueued, reset_for_retry = [], []
    try:
        for r in plan["never_sent_resendable"]:
            order = db.query(Order).filter(Order.id == r.id).first()
            if not order:
                continue
            log_id = enqueue_purchase_for_order(db, order)
            if log_id:
                enqueued.append((order.order_number, log_id))

        for r in plan["failed_retryable"]:
            row = db.query(MetaCapiLog).filter(MetaCapiLog.id == r.log_id).first()
            if not row:
                continue
            row.status = "retry"
            row.retry_count = 0  # fresh budget — this is a deliberate human-approved re-attempt, not an automatic loop
            row.retry_at = datetime.now(timezone.utc).replace(tzinfo=None)
            row.error_message = (row.error_message or "") + " [reset by meta_capi_repair.py for a fresh retry attempt]"
            reset_for_retry.append((r.order_number, row.id))

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print(f"\n✓ Enqueued {len(enqueued)} new Purchase send(s) (will be sent by the next BackgroundTask/sweep run):")
    for order_number, log_id in enqueued:
        print(f"    {order_number}  -> meta_capi_logs.id={log_id}")

    print(f"\n✓ Reset {len(reset_for_retry)} failed row(s) to 'retry' (will be picked up by the next periodic sweep):")
    for order_number, log_id in reset_for_retry:
        print(f"    {order_number}  -> meta_capi_logs.id={log_id}")

    print(
        "\nNothing was sent to Meta directly by this script — the actual network "
        "call happens through the existing BackgroundTasks/periodic-sweep path, "
        "with the same idempotency and retry guarantees as normal order creation."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Meta CAPI / ERP repair plan (report-only unless --execute is passed).")
    parser.add_argument("--store-id", required=True)
    parser.add_argument("--since", default="2020-01-01")
    parser.add_argument("--until", default=datetime.now(timezone.utc).strftime("%Y-%m-%d 23:59:59"))
    parser.add_argument("--execute", action="store_true", help="Actually enqueue/reset category A/B rows. Category C/D are never touched.")
    args = parser.parse_args()

    plan = build_plan(args.store_id, args.since, args.until)
    print_plan(plan)

    if not args.execute:
        print("\n(Report-only mode — pass --execute to apply the A/B actions above. Nothing was changed.)")
        return

    total_actionable = len(plan["never_sent_resendable"]) + len(plan["failed_retryable"])
    if total_actionable == 0:
        print("\nNothing actionable to execute.")
        return

    confirm = input(
        f"\nType 'yes' to enqueue {len(plan['never_sent_resendable'])} new send(s) and reset "
        f"{len(plan['failed_retryable'])} failed row(s) for retry: "
    )
    if confirm.strip().lower() != "yes":
        print("Aborted — no changes made.")
        return

    execute_plan(plan, args.store_id)


if __name__ == "__main__":
    main()
