// ═══════════════════════════════════════════════════════════════
// Analytics Formula Library
// All percentage formulas return integer percentages (0-100).
// Uses safeDivide to prevent division by zero.
// Uses safeMoney for monetary rounding (DA integers).
// ═══════════════════════════════════════════════════════════════

import { safeDivide, safeMoney } from './format';

/**
 * True Conversion Rate — what % of ALL orders eventually get delivered.
 *
 * Formula:  (deliveredOrders / totalOrders) × 100
 * Range:    0–100%
 *
 * This is the "end-to-end" conversion — from order creation to
 * successful delivery. A low rate indicates problems in the
 * fulfillment pipeline (calls, confirmations, shipping).
 *
 * @param totalOrders    Total number of orders (denominator, includes all statuses).
 * @param deliveredOrders Number of orders with status DELIVERED.
 * @returns Integer percentage (0–100).
 */
export function calcTrueConversionRate(totalOrders: number, deliveredOrders: number): number {
  return Math.round(safeDivide(deliveredOrders, totalOrders) * 100);
}

/**
 * Return Rate — what % of delivered orders get returned.
 *
 * Formula:  (returnedOrders / deliveredOrders) × 100
 * Range:    0–100%
 *
 * High return rates (>15%) signal quality issues, wrong sizing,
 * or misleading product descriptions.
 *
 * @param deliveredOrders Number of delivered orders (denominator).
 * @param returnedOrders  Number of returned orders.
 * @returns Integer percentage (0–100).
 */
export function calcReturnRate(deliveredOrders: number, returnedOrders: number): number {
  return Math.round(safeDivide(returnedOrders, deliveredOrders) * 100);
}

/**
 * Order Funnel Rates — stage-by-stage conversion through the pipeline.
 *
 * Each rate measures the drop-off between consecutive pipeline stages.
 *
 * Pipeline:  NEW → ASSIGNED → CALLED → CONFIRMED(+SHIPPED+DELIVERED)
 *
 *   assignRate  = ASSIGNED / NEW          × 100  (% of new orders assigned)
 *   callRate    = CALLED   / ASSIGNED     × 100  (% of assigned orders called)
 *   confirmRate = CONFIRMED / CALLED      × 100  (% of called orders confirmed)
 *   deliverRate = DELIVERED / CONFIRMED   × 100  (% of confirmed orders delivered)
 *
 * Note: `confirmedOrders` includes SHIPPED + DELIVERED statuses.
 */
export interface FunnelRates {
  assignRate: number;
  callRate: number;
  confirmRate: number;
  deliverRate: number;
}

export function calcFunnelRates(
  newOrders: number,
  assignedOrders: number,
  calledOrders: number,
  confirmedOrders: number,   // includes SHIPPED + DELIVERED
  deliveredOrders: number,
): FunnelRates {
  return {
    assignRate: Math.round(safeDivide(assignedOrders, newOrders) * 100),
    callRate: Math.round(safeDivide(calledOrders, assignedOrders) * 100),
    confirmRate: Math.round(safeDivide(confirmedOrders, calledOrders) * 100),
    deliverRate: Math.round(safeDivide(deliveredOrders, confirmedOrders) * 100),
  };
}

/**
 * Period-over-period change for a metric (revenue, orders, etc.).
 *
 * Formula:  ((current - previous) / previous) × 100
 * Range:    -100 to +∞ (practically bounded by data)
 *
 * Edge cases:
 *   - Returns 100  if previous was 0 but current > 0 (new metric appeared).
 *   - Returns 0    if both are 0 (no data in either period).
 *
 * @param current  Value in the current period.
 * @param previous Value in the previous period (denominator).
 * @returns Integer percentage change.
 */
export function calcPeriodChange(current: number, previous: number): number {
  if (previous > 0) {
    return Math.round(safeDivide(current - previous, previous) * 100);
  }
  return current > 0 ? 100 : 0;
}

/**
 * Average Order Value — mean revenue per order.
 *
 * Formula:  totalRevenue / totalOrders
 *
 * Uses safeDivide to prevent division by zero (returns 0 when no orders).
 * Result is rounded to the nearest DA via safeMoney.
 *
 * @param totalRevenue  Sum of all order totals.
 * @param totalOrders   Number of orders.
 * @returns Integer DA value (rounded).
 */
export function calcAverageOrderValue(totalRevenue: number, totalOrders: number): number {
  return safeMoney(safeDivide(totalRevenue, totalOrders));
}
