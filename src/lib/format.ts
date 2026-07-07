// ═══════════════════════════════════════════════════════════════
// Shared formatting & monetary utilities
// All monetary values are stored as Int (Algerian Dinar, no subunits).
// ═══════════════════════════════════════════════════════════════

/**
 * Round a monetary value to the nearest integer DA.
 * Prevents floating-point precision issues from calculations
 * (e.g., percentage discounts) before storing to the database.
 */
export function safeMoney(value: number): number {
  return Math.round(value);
}

/**
 * Safe division — returns 0 if divisor is 0 instead of Infinity/NaN.
 */
export function safeDivide(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Format a price in Algerian Dinar (DA).
 * Expects an integer DA value (no cents/subunits).
 */
export function formatPrice(amount: number): string {
  return new Intl.NumberFormat('fr-DZ', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(amount)) + ' DA';
}

/**
 * Hash a string to a number (for simple sharding/hashing).
 */
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
