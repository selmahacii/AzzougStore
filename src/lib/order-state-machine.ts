// ═══════════════════════════════════════════════════════════════
// Order State Machine
// Defines valid status transitions and stock side effects.
// ═══════════════════════════════════════════════════════════════

export type OrderStatus =
  | 'NEW'
  | 'ASSIGNED'
  | 'CALLED'
  | 'CONFIRMED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'RETURNED';

export type StockMovementType =
  | 'ORDER_RESERVE'
  | 'ORDER_CONFIRM'
  | 'ORDER_RELEASE'
  | 'RETURN_RESTOCK'
  | 'MANUAL_ADJUSTMENT'
  | 'RESTOCK';

// ─── Valid Transitions ──────────────────────────────────────

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  NEW: ['ASSIGNED', 'RETURNED'],
  ASSIGNED: ['CALLED', 'RETURNED'],
  CALLED: ['CONFIRMED', 'NEW', 'RETURNED'],
  CONFIRMED: ['SHIPPED', 'RETURNED'],
  SHIPPED: ['DELIVERED', 'RETURNED'],
  DELIVERED: ['RETURNED'],
  RETURNED: [],
};

/**
 * Check if a status transition is valid.
 * Returns true if `from` → `to` is an allowed transition.
 * Same status transitions are NOT allowed (returns false).
 */
export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get all allowed transitions from a given status.
 */
export function getAllowedTransitions(from: OrderStatus): OrderStatus[] {
  return VALID_TRANSITIONS[from] ?? [];
}

// ─── Stock Side Effects ─────────────────────────────────────

interface StockEffect {
  type: StockMovementType;
  stockDelta: number;      // change to product.stock
  reservedDelta: number;   // change to product.reservedStock
}

/**
 * Determine stock side effects for a status transition.
 *
 * Rules:
 * - NEW order creation: reservedStock += qty (ORDER_RESERVE)
 * - CALLED → CONFIRMED: stock -= qty, reservedStock -= qty (ORDER_CONFIRM)
 * - ANY → RETURNED:
 *   - If was CONFIRMED/SHIPPED/DELIVERED: stock += qty (RETURN_RESTOCK)
 *   - If was NEW/ASSIGNED/CALLED: reservedStock -= qty (ORDER_RELEASE)
 */
export function getStockEffect(fromStatus: OrderStatus, toStatus: OrderStatus): StockEffect | null {
  // RETURNED from a confirmed/shipped/delivered state → restock
  if (toStatus === 'RETURNED') {
    const confirmedStates: OrderStatus[] = ['CONFIRMED', 'SHIPPED', 'DELIVERED'];
    if (confirmedStates.includes(fromStatus)) {
      return { type: 'RETURN_RESTOCK', stockDelta: 1, reservedDelta: 0 };
    }
    // NEW/ASSIGNED/CALLED → RETURNED: release reserved stock
    return { type: 'ORDER_RELEASE', stockDelta: 0, reservedDelta: -1 };
  }

  // CALLED → CONFIRMED: deduct stock and release reservation
  if (toStatus === 'CONFIRMED' && fromStatus === 'CALLED') {
    return { type: 'ORDER_CONFIRM', stockDelta: -1, reservedDelta: -1 };
  }

  return null; // No stock effect for this transition
}

/**
 * Status labels in French
 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: 'Nouvelle',
  ASSIGNED: 'Assignée',
  CALLED: 'Appelée',
  CONFIRMED: 'Confirmée',
  SHIPPED: 'Expédiée',
  DELIVERED: 'Livrée',
  RETURNED: 'Retournée',
};
