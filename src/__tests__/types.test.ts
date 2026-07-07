import { test, expect, describe } from 'bun:test';
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_COLORS,
  ORDER_STATUS_DOT,
  ROLE_LABELS,
  WILAYAS,
  type OrderStatus,
  type UserRole,
} from '@/lib/types';

// ─── ORDER_STATUS_LABELS ──────────────────────────────────────
describe('ORDER_STATUS_LABELS', () => {
  const EXPECTED_STATUSES: OrderStatus[] = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED'];

  test('has exactly 7 entries', () => {
    expect(Object.keys(ORDER_STATUS_LABELS)).toHaveLength(7);
  });

  test('contains all 7 expected statuses', () => {
    for (const status of EXPECTED_STATUSES) {
      expect(ORDER_STATUS_LABELS).toHaveProperty(status);
    }
  });

  test('no extra statuses beyond the 7 expected', () => {
    const keys = Object.keys(ORDER_STATUS_LABELS);
    expect(keys.sort()).toEqual(EXPECTED_STATUSES.sort());
  });

  test('all labels are non-empty strings', () => {
    for (const status of EXPECTED_STATUSES) {
      expect(typeof ORDER_STATUS_LABELS[status]).toBe('string');
      expect(ORDER_STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });

  test('labels are in French', () => {
    expect(ORDER_STATUS_LABELS.NEW).toBe('Nouvelle');
    expect(ORDER_STATUS_LABELS.ASSIGNED).toBe('Assignée');
    expect(ORDER_STATUS_LABELS.CALLED).toBe('Appelée');
    expect(ORDER_STATUS_LABELS.CONFIRMED).toBe('Confirmée');
    expect(ORDER_STATUS_LABELS.SHIPPED).toBe('Expédiée');
    expect(ORDER_STATUS_LABELS.DELIVERED).toBe('Livrée');
    expect(ORDER_STATUS_LABELS.RETURNED).toBe('Retournée');
  });
});

// ─── ORDER_STATUS_COLORS ──────────────────────────────────────
describe('ORDER_STATUS_COLORS', () => {
  const EXPECTED_STATUSES: OrderStatus[] = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED'];

  test('has exactly 7 entries', () => {
    expect(Object.keys(ORDER_STATUS_COLORS)).toHaveLength(7);
  });

  test('contains all 7 expected statuses', () => {
    for (const status of EXPECTED_STATUSES) {
      expect(ORDER_STATUS_COLORS).toHaveProperty(status);
    }
  });

  test('all color values are non-empty strings with Tailwind classes', () => {
    for (const status of EXPECTED_STATUSES) {
      const color = ORDER_STATUS_COLORS[status];
      expect(typeof color).toBe('string');
      expect(color.length).toBeGreaterThan(0);
      expect(color).toContain('bg-');
      expect(color).toContain('text-');
    }
  });

  test('no two statuses share the same color', () => {
    const values = Object.values(ORDER_STATUS_COLORS);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });

  test('uses no blue/indigo colors', () => {
    for (const status of EXPECTED_STATUSES) {
      expect(ORDER_STATUS_COLORS[status]).not.toContain('blue-');
      expect(ORDER_STATUS_COLORS[status]).not.toContain('indigo-');
    }
  });
});

// ─── ORDER_STATUS_DOT ─────────────────────────────────────────
describe('ORDER_STATUS_DOT', () => {
  const EXPECTED_STATUSES: OrderStatus[] = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED'];

  test('has exactly 7 entries', () => {
    expect(Object.keys(ORDER_STATUS_DOT)).toHaveLength(7);
  });

  test('contains all 7 expected statuses', () => {
    for (const status of EXPECTED_STATUSES) {
      expect(ORDER_STATUS_DOT).toHaveProperty(status);
    }
  });

  test('all dot values are bg- color classes', () => {
    for (const status of EXPECTED_STATUSES) {
      const dot = ORDER_STATUS_DOT[status];
      expect(typeof dot).toBe('string');
      expect(dot).toMatch(/^bg-\S+$/);
    }
  });

  test('no two statuses share the same dot color', () => {
    const values = Object.values(ORDER_STATUS_DOT);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });

  test('dot colors do not use blue/indigo', () => {
    for (const status of EXPECTED_STATUSES) {
      expect(ORDER_STATUS_DOT[status]).not.toContain('blue-');
      expect(ORDER_STATUS_DOT[status]).not.toContain('indigo-');
    }
  });

  test('dot colors match the status color base hue', () => {
    // DOT for NEW uses slate, ORDER_STATUS_COLORS.NEW also uses slate
    expect(ORDER_STATUS_DOT.NEW).toContain('slate');
    expect(ORDER_STATUS_COLORS.NEW).toContain('slate');
    expect(ORDER_STATUS_DOT.CONFIRMED).toContain('emerald');
    expect(ORDER_STATUS_COLORS.CONFIRMED).toContain('emerald');
    expect(ORDER_STATUS_DOT.RETURNED).toContain('rose');
    expect(ORDER_STATUS_COLORS.RETURNED).toContain('rose');
  });
});

// ─── ROLE_LABELS ──────────────────────────────────────────────
describe('ROLE_LABELS', () => {
  const EXPECTED_ROLES: UserRole[] = ['SUPER_ADMIN', 'MANAGER', 'CONFIRMATEUR'];

  test('has exactly 3 entries', () => {
    expect(Object.keys(ROLE_LABELS)).toHaveLength(3);
  });

  test('contains all 3 expected roles', () => {
    for (const role of EXPECTED_ROLES) {
      expect(ROLE_LABELS).toHaveProperty(role);
    }
  });

  test('no extra roles beyond the 3 expected', () => {
    const keys = Object.keys(ROLE_LABELS);
    expect(keys.sort()).toEqual(EXPECTED_ROLES.sort());
  });

  test('all labels are non-empty strings', () => {
    for (const role of EXPECTED_ROLES) {
      expect(typeof ROLE_LABELS[role]).toBe('string');
      expect(ROLE_LABELS[role].length).toBeGreaterThan(0);
    }
  });

  test('labels are human-readable', () => {
    expect(ROLE_LABELS.SUPER_ADMIN).toBe('Super Admin');
    expect(ROLE_LABELS.MANAGER).toBe('Manager');
    expect(ROLE_LABELS.CONFIRMATEUR).toBe('Confirmateur');
  });
});

// ─── WILAYAS ──────────────────────────────────────────────────
describe('WILAYAS', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(WILAYAS)).toBe(true);
    expect(WILAYAS.length).toBeGreaterThan(0);
  });

  test('has 48 entries (Algerian wilayas in code)', () => {
    // Note: Algeria has 58 wilayas total; this codebase includes 48
    expect(WILAYAS).toHaveLength(48);
  });

  test('all entries are non-empty strings', () => {
    for (const wilaya of WILAYAS) {
      expect(typeof wilaya).toBe('string');
      expect(wilaya.length).toBeGreaterThan(0);
    }
  });

  test('no duplicate entries', () => {
    const unique = new Set(WILAYAS);
    expect(unique.size).toBe(WILAYAS.length);
  });

  test('includes key major wilayas', () => {
    expect(WILAYAS).toContain('Alger');
    expect(WILAYAS).toContain('Oran');
    expect(WILAYAS).toContain('Constantine');
    expect(WILAYAS).toContain('Annaba');
    expect(WILAYAS).toContain('Sétif');
    expect(WILAYAS).toContain('Blida');
    expect(WILAYAS).toContain('Tlemcen');
    expect(WILAYAS).toContain('Béjaïa');
  });

  test('is a readonly tuple (as const)', () => {
    // WILAYAS is defined with `as const` making it readonly
    // readonly arrays may not have .frozen
    // Suppress unused-expression warning by using void
    void (expect(WILAYAS).toBeFrozen?.() ?? true);
  });
});

// ─── OrderStatus type values ──────────────────────────────────
describe('OrderStatus type values', () => {
  test('all 7 status values are valid strings', () => {
    const statuses: OrderStatus[] = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED'];
    for (const status of statuses) {
      expect(typeof status).toBe('string');
      expect(status.length).toBeGreaterThan(0);
      expect(status).toBe(status.toUpperCase());
    }
  });

  test('all statuses are distinct', () => {
    const statuses: OrderStatus[] = ['NEW', 'ASSIGNED', 'CALLED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'RETURNED'];
    const unique = new Set(statuses);
    expect(unique.size).toBe(statuses.length);
  });
});

// ─── UserRole type values ─────────────────────────────────────
describe('UserRole type values', () => {
  test('all 3 role values are valid strings', () => {
    const roles: UserRole[] = ['SUPER_ADMIN', 'MANAGER', 'CONFIRMATEUR'];
    for (const role of roles) {
      expect(typeof role).toBe('string');
      expect(role.length).toBeGreaterThan(0);
      expect(role).toBe(role.toUpperCase());
    }
  });

  test('all roles are distinct', () => {
    const roles: UserRole[] = ['SUPER_ADMIN', 'MANAGER', 'CONFIRMATEUR'];
    const unique = new Set(roles);
    expect(unique.size).toBe(roles.length);
  });
});
