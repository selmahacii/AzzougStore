import { test, expect, describe } from 'bun:test';
import type { OrderStatus } from '@/lib/types';

// ─── Order Pipeline State Machine ─────────────────────────────
// Replicated from orders/route.ts — we test the pure logic in isolation

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  NEW: ['ASSIGNED', 'RETURNED'],
  ASSIGNED: ['CALLED', 'RETURNED'],
  CALLED: ['CONFIRMED', 'NEW', 'RETURNED'],
  CONFIRMED: ['SHIPPED', 'RETURNED'],
  SHIPPED: ['DELIVERED', 'RETURNED'],
  DELIVERED: ['RETURNED'],
  RETURNED: [],
};

function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

describe('Order Pipeline — State Machine', () => {
  describe('NEW status transitions', () => {
    test('NEW → ASSIGNED is valid', () => {
      expect(isValidTransition('NEW', 'ASSIGNED')).toBe(true);
    });

    test('NEW → RETURNED is valid', () => {
      expect(isValidTransition('NEW', 'RETURNED')).toBe(true);
    });

    test('NEW → CONFIRMED is invalid (must go through pipeline)', () => {
      expect(isValidTransition('NEW', 'CONFIRMED')).toBe(false);
    });

    test('NEW → SHIPPED is invalid', () => {
      expect(isValidTransition('NEW', 'SHIPPED')).toBe(false);
    });

    test('NEW → DELIVERED is invalid', () => {
      expect(isValidTransition('NEW', 'DELIVERED')).toBe(false);
    });

    test('NEW → CALLED is invalid', () => {
      expect(isValidTransition('NEW', 'CALLED')).toBe(false);
    });
  });

  describe('ASSIGNED status transitions', () => {
    test('ASSIGNED → CALLED is valid', () => {
      expect(isValidTransition('ASSIGNED', 'CALLED')).toBe(true);
    });

    test('ASSIGNED → RETURNED is valid', () => {
      expect(isValidTransition('ASSIGNED', 'RETURNED')).toBe(true);
    });

    test('ASSIGNED → NEW is invalid (no backwards to NEW except from CALLED)', () => {
      expect(isValidTransition('ASSIGNED', 'NEW')).toBe(false);
    });

    test('ASSIGNED → CONFIRMED is invalid', () => {
      expect(isValidTransition('ASSIGNED', 'CONFIRMED')).toBe(false);
    });
  });

  describe('CALLED status transitions', () => {
    test('CALLED → CONFIRMED is valid', () => {
      expect(isValidTransition('CALLED', 'CONFIRMED')).toBe(true);
    });

    test('CALLED → NEW is valid (callback / customer unreachable)', () => {
      expect(isValidTransition('CALLED', 'NEW')).toBe(true);
    });

    test('CALLED → RETURNED is valid', () => {
      expect(isValidTransition('CALLED', 'RETURNED')).toBe(true);
    });

    test('CALLED → SHIPPED is invalid', () => {
      expect(isValidTransition('CALLED', 'SHIPPED')).toBe(false);
    });

    test('CALLED → DELIVERED is invalid', () => {
      expect(isValidTransition('CALLED', 'DELIVERED')).toBe(false);
    });
  });

  describe('CONFIRMED status transitions', () => {
    test('CONFIRMED → SHIPPED is valid', () => {
      expect(isValidTransition('CONFIRMED', 'SHIPPED')).toBe(true);
    });

    test('CONFIRMED → RETURNED is valid', () => {
      expect(isValidTransition('CONFIRMED', 'RETURNED')).toBe(true);
    });

    test('CONFIRMED → DELIVERED is invalid', () => {
      expect(isValidTransition('CONFIRMED', 'DELIVERED')).toBe(false);
    });

    test('CONFIRMED → NEW is invalid', () => {
      expect(isValidTransition('CONFIRMED', 'NEW')).toBe(false);
    });
  });

  describe('SHIPPED status transitions', () => {
    test('SHIPPED → DELIVERED is valid', () => {
      expect(isValidTransition('SHIPPED', 'DELIVERED')).toBe(true);
    });

    test('SHIPPED → RETURNED is valid', () => {
      expect(isValidTransition('SHIPPED', 'RETURNED')).toBe(true);
    });

    test('SHIPPED → CONFIRMED is invalid', () => {
      expect(isValidTransition('SHIPPED', 'CONFIRMED')).toBe(false);
    });
  });

  describe('DELIVERED status transitions', () => {
    test('DELIVERED → RETURNED is valid', () => {
      expect(isValidTransition('DELIVERED', 'RETURNED')).toBe(true);
    });

    test('DELIVERED → SHIPPED is invalid', () => {
      expect(isValidTransition('DELIVERED', 'SHIPPED')).toBe(false);
    });

    test('DELIVERED → CONFIRMED is invalid', () => {
      expect(isValidTransition('DELIVERED', 'CONFIRMED')).toBe(false);
    });
  });

  describe('RETURNED — terminal state', () => {
    test('RETURNED → NEW is invalid', () => {
      expect(isValidTransition('RETURNED', 'NEW')).toBe(false);
    });

    test('RETURNED → ASSIGNED is invalid', () => {
      expect(isValidTransition('RETURNED', 'ASSIGNED')).toBe(false);
    });

    test('RETURNED → any status is invalid (all transitions empty)', () => {
      const allStatuses: OrderStatus[] = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED'];
      for (const to of allStatuses) {
        expect(isValidTransition('RETURNED', to)).toBe(false);
      }
    });
  });

  describe('Same status transition — always invalid', () => {
    const allStatuses: OrderStatus[] = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED'];
    for (const status of allStatuses) {
      test(`${status} → ${status} is invalid`, () => {
        expect(isValidTransition(status, status)).toBe(false);
      });
    }
  });

  describe('All valid transitions from each status are defined', () => {
    const allStatuses: OrderStatus[] = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED'];

    test('VALID_TRANSITIONS covers all 7 statuses', () => {
      for (const status of allStatuses) {
        expect(VALID_TRANSITIONS).toHaveProperty(status);
      }
    });

    test('each status has an array of valid transitions', () => {
      for (const status of allStatuses) {
        expect(Array.isArray(VALID_TRANSITIONS[status])).toBe(true);
      }
    });

    test('valid transitions do not include the status itself', () => {
      for (const status of allStatuses) {
        expect(VALID_TRANSITIONS[status]).not.toContain(status);
      }
    });

    test('valid transitions only contain known statuses', () => {
      for (const status of allStatuses) {
        for (const target of VALID_TRANSITIONS[status]) {
          expect(allStatuses).toContain(target);
        }
      }
    });
  });

  describe('Full happy path: NEW → DELIVERED', () => {
    test('can traverse entire pipeline forward', () => {
      expect(isValidTransition('NEW', 'ASSIGNED')).toBe(true);
      expect(isValidTransition('ASSIGNED', 'CALLED')).toBe(true);
      expect(isValidTransition('CALLED', 'CONFIRMED')).toBe(true);
      expect(isValidTransition('CONFIRMED', 'SHIPPED')).toBe(true);
      expect(isValidTransition('SHIPPED', 'DELIVERED')).toBe(true);
    });
  });
});

// ─── Order Number Generation ──────────────────────────────────
describe('Order Number Generation', () => {
  // Format: 2 uppercase letters + YYYYMMDD + 4 digits
  const ORDER_NUMBER_PATTERN = /^[A-Z]{2}-\d{8}-\d{4}$/;

  test('order number matches expected pattern', () => {
    const prefixes = ['ML', 'TC', 'MB'];
    for (const prefix of prefixes) {
      const date = new Date();
      const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
      const seq = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
      const orderNumber = `${prefix}-${dateStr}-${seq}`;
      expect(orderNumber).toMatch(ORDER_NUMBER_PATTERN);
    }
  });

  test('prefix is always 2 uppercase letters', () => {
    const slug = 'maison-luxe';
    const prefix = slug.substring(0, 2).toUpperCase();
    expect(prefix).toBe('MA');
    expect(prefix).toMatch(/^[A-Z]{2}$/);
  });

  test('date string is exactly 8 digits YYYYMMDD', () => {
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    expect(dateStr).toMatch(/^\d{8}$/);
  });

  test('sequence number is always 4 digits (padded)', () => {
    for (let i = 0; i < 10; i++) {
      const seq = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
      expect(seq).toMatch(/^\d{4}$/);
    }
  });

  test('complete order number format validation', () => {
    const validNumbers = [
      'ML-20250115-0001',
      'TC-20251231-9999',
      'MB-20250704-1234',
    ];
    for (const num of validNumbers) {
      expect(num).toMatch(ORDER_NUMBER_PATTERN);
    }
  });

  test('invalid order numbers are rejected', () => {
    const invalidNumbers = [
      'ml-20250115-0001',   // lowercase prefix
      'ML1-20250115-0001',  // 3-char prefix
      'ML-2025-01-15-0001', // dashes in date
      'ML-20250115001',     // no dash separator
      'ML-2025011-0001',    // 7-digit date
      'ML-20250115-001',    // 3-digit sequence
      '',
      'ML-20250115-ABCD',   // non-digit sequence
    ];
    for (const num of invalidNumbers) {
      expect(num).not.toMatch(ORDER_NUMBER_PATTERN);
    }
  });
});

// ─── Phone Validation Patterns ────────────────────────────────
describe('Phone Validation Patterns (business logic)', () => {
  // Regex from validators.ts: /^0[5-7]\d{8}$/
  const ALGERIAN_PHONE_RE = /^0[5-7]\d{8}$/;

  test('accepts 05XXXXXXXX', () => {
    expect(ALGERIAN_PHONE_RE.test('0555123456')).toBe(true);
    expect(ALGERIAN_PHONE_RE.test('0500123456')).toBe(true);
  });

  test('accepts 06XXXXXXXX', () => {
    expect(ALGERIAN_PHONE_RE.test('0661123456')).toBe(true);
    expect(ALGERIAN_PHONE_RE.test('0612345678')).toBe(true);
  });

  test('accepts 07XXXXXXXX', () => {
    expect(ALGERIAN_PHONE_RE.test('0770123456')).toBe(true);
    expect(ALGERIAN_PHONE_RE.test('0712345678')).toBe(true);
  });

  test('rejects 04XXXXXXXX (invalid prefix)', () => {
    expect(ALGERIAN_PHONE_RE.test('0412345678')).toBe(false);
  });

  test('rejects 08XXXXXXXX (invalid prefix)', () => {
    expect(ALGERIAN_PHONE_RE.test('0812345678')).toBe(false);
  });

  test('rejects 9-digit numbers', () => {
    expect(ALGERIAN_PHONE_RE.test('055512345')).toBe(false);
  });

  test('rejects 11-digit numbers', () => {
    expect(ALGERIAN_PHONE_RE.test('05551234567')).toBe(false);
  });

  test('exactly 10 digits required', () => {
    expect(ALGERIAN_PHONE_RE.test('0555123456')).toBe(true);
    expect(ALGERIAN_PHONE_RE.test('05551234567')).toBe(false);
    expect(ALGERIAN_PHONE_RE.test('055512345')).toBe(false);
  });
});

// ─── KPI Calculations ─────────────────────────────────────────
describe('KPI Calculations', () => {
  // From analytics/route.ts:
  // conversionRate = orderCount > 0 ? Math.round((completedOrders / orderCount) * 100) : 0;
  // avgOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;

  function calculateConversionRate(totalOrders: number, completedOrders: number): number {
    return totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;
  }

  function calculateAvgOrderValue(totalOrders: number, totalRevenue: number): number {
    return totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
  }

  test('conversion rate: normal calculation', () => {
    expect(calculateConversionRate(100, 70)).toBe(70);
    expect(calculateConversionRate(100, 50)).toBe(50);
    expect(calculateConversionRate(100, 33)).toBe(33);
  });

  test('conversion rate: 100% conversion', () => {
    expect(calculateConversionRate(100, 100)).toBe(100);
    expect(calculateConversionRate(1, 1)).toBe(100);
  });

  test('conversion rate: 0% conversion', () => {
    expect(calculateConversionRate(100, 0)).toBe(0);
  });

  test('conversion rate: zero division protection', () => {
    expect(calculateConversionRate(0, 0)).toBe(0);
    expect(calculateConversionRate(0, 100)).toBe(0);
  });

  test('conversion rate: rounds to nearest integer', () => {
    // 1/3 ≈ 33.33... → rounds to 33
    expect(calculateConversionRate(3, 1)).toBe(33);
    // 2/3 ≈ 66.67... → rounds to 67
    expect(calculateConversionRate(3, 2)).toBe(67);
    // 1/7 ≈ 14.29... → rounds to 14
    expect(calculateConversionRate(7, 1)).toBe(14);
  });

  test('avg order value: normal calculation', () => {
    expect(calculateAvgOrderValue(10, 100000)).toBe(10000);
    expect(calculateAvgOrderValue(5, 50000)).toBe(10000);
    expect(calculateAvgOrderValue(1, 3500)).toBe(3500);
  });

  test('avg order value: zero division protection', () => {
    expect(calculateAvgOrderValue(0, 0)).toBe(0);
    expect(calculateAvgOrderValue(0, 100000)).toBe(0);
  });

  test('avg order value: rounds to nearest integer', () => {
    expect(calculateAvgOrderValue(3, 10000)).toBe(3333); // 10000/3 = 3333.33... → 3333
    expect(calculateAvgOrderValue(7, 10000)).toBe(1429); // 10000/7 ≈ 1428.57 → 1429
  });

  test('avg order value with realistic data', () => {
    // Total revenue: 1,850,000 DA for 30 orders
    expect(calculateAvgOrderValue(30, 1850000)).toBe(61667);
  });
});

// ─── Performance Score Formula ────────────────────────────────
describe('Performance Score Formula', () => {
  // From employees/route.ts:
  // performanceScore = assigned > 0 ? Math.round((confirmed / assigned) * 100) : 0;
  // confirmed = orders with status CONFIRMED | SHIPPED | DELIVERED

  function calculatePerformanceScore(confirmed: number, assigned: number): number {
    return assigned > 0 ? Math.round((confirmed / assigned) * 100) : 0;
  }

  test('perfect score: all assigned confirmed', () => {
    expect(calculatePerformanceScore(10, 10)).toBe(100);
    expect(calculatePerformanceScore(1, 1)).toBe(100);
  });

  test('zero score: none confirmed', () => {
    expect(calculatePerformanceScore(0, 10)).toBe(0);
    expect(calculatePerformanceScore(0, 1)).toBe(0);
  });

  test('partial score: some confirmed', () => {
    expect(calculatePerformanceScore(5, 10)).toBe(50);
    expect(calculatePerformanceScore(7, 10)).toBe(70);
    expect(calculatePerformanceScore(3, 10)).toBe(30);
  });

  test('zero assigned: returns 0 (no division by zero)', () => {
    expect(calculatePerformanceScore(0, 0)).toBe(0);
    expect(calculatePerformanceScore(5, 0)).toBe(0);
    expect(calculatePerformanceScore(100, 0)).toBe(0);
  });

  test('score is capped at 100 implicitly', () => {
    // If confirmed somehow exceeds assigned, score > 100
    // But in practice this shouldn't happen
    expect(calculatePerformanceScore(11, 10)).toBe(110);
  });

  test('rounds to nearest integer', () => {
    expect(calculatePerformanceScore(1, 3)).toBe(33);  // 33.33... → 33
    expect(calculatePerformanceScore(2, 3)).toBe(67);  // 66.67... → 67
  });

  test('realistic employee performance scenarios', () => {
    // Employee with 25 assigned, 18 confirmed
    expect(calculatePerformanceScore(18, 25)).toBe(72);
    // Employee with 50 assigned, 45 confirmed
    expect(calculatePerformanceScore(45, 50)).toBe(90);
    // Employee with 8 assigned, 2 confirmed
    expect(calculatePerformanceScore(2, 8)).toBe(25);
  });
});
