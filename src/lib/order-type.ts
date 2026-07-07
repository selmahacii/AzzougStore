/**
 * Order TYPE = business ORIGIN of the order — independent from its status.
 *
 *   🟦 NORMAL     — the customer completed the checkout and clicked
 *                   "Place Order" themselves. A real order from day one.
 *   🟧 ABANDONED  — a shopping session, NOT an order: the customer filled
 *                   (part of) the checkout but never clicked "Place Order".
 *   🟩 RECOVERED  — an abandoned cart later confirmed by a confirmatrice.
 *
 * The only allowed type transition is ABANDONED → RECOVERED (marked once by
 * `recovered_at` on the backend). The type NEVER flips back afterwards,
 * whatever the status does (delivered, returned, cancelled…).
 * Normal orders never become recovered; recovered never become normal.
 */

import type { Order } from '@/lib/types';

export type OrderType = 'NORMAL' | 'ABANDONED' | 'RECOVERED';

export function getOrderType(order: Pick<Order, 'is_abandoned_cart' | 'status'> & { recovered_at?: string | null }): OrderType {
  if (!order.is_abandoned_cart) return 'NORMAL';
  if (order.recovered_at) return 'RECOVERED';
  // Legacy fallback for rows created before recovered_at existed:
  // a cart that reached the confirmed pipeline was recovered.
  if (['CONFIRMED', 'SHIPPED', 'DELIVERED'].includes(order.status)) return 'RECOVERED';
  return 'ABANDONED';
}

/** Consistent color system (see docs/AUDIT — badges):
 *  blue = normal, orange = abandoned, green = recovered, purple = duplicates. */
export const ORDER_TYPE_META: Record<OrderType, { label: string; emoji: string; className: string }> = {
  NORMAL: {
    label: 'Commande Normale',
    emoji: '🟦',
    className: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  ABANDONED: {
    label: 'Panier Abandonné',
    emoji: '🟧',
    className: 'bg-orange-50 text-orange-700 border-orange-200',
  },
  RECOVERED: {
    label: 'Panier Récupéré',
    emoji: '🟩',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
};
