import { test, expect, describe } from 'bun:test';
import { clampPageSize, safeJsonParse, validatePhone } from '@/lib/validators';

// ─── clampPageSize ────────────────────────────────────────────
describe('clampPageSize()', () => {
  test('returns the value itself when within range', () => {
    expect(clampPageSize(10)).toBe(10);
    expect(clampPageSize(1)).toBe(1);
    expect(clampPageSize(100)).toBe(100);
    expect(clampPageSize(50)).toBe(50);
  });

  test('clamps to min when value is below min', () => {
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(-1)).toBe(1);
    expect(clampPageSize(-100)).toBe(1);
    expect(clampPageSize(-Infinity)).toBe(1);
  });

  test('clamps to max when value exceeds max', () => {
    expect(clampPageSize(101)).toBe(100);
    expect(clampPageSize(500)).toBe(100);
    expect(clampPageSize(9999)).toBe(100);
    expect(clampPageSize(Infinity)).toBe(100);
  });

  test('uses default max=100 and min=1', () => {
    expect(clampPageSize(150)).toBe(100);
    expect(clampPageSize(0)).toBe(1);
  });

  test('respects custom max and min parameters', () => {
    expect(clampPageSize(5, 10, 2)).toBe(5);
    expect(clampPageSize(1, 10, 2)).toBe(2);
    expect(clampPageSize(15, 10, 2)).toBe(10);
    expect(clampPageSize(0, 10, 2)).toBe(2);
    expect(clampPageSize(20, 10, 2)).toBe(10);
  });

  test('handles boundary values precisely', () => {
    expect(clampPageSize(1, 100, 1)).toBe(1);
    expect(clampPageSize(100, 100, 1)).toBe(100);
    expect(clampPageSize(1, 1, 1)).toBe(1);
    expect(clampPageSize(10, 10, 10)).toBe(10);
  });

  test('handles very small custom min', () => {
    expect(clampPageSize(0, 100, 0)).toBe(0);
    expect(clampPageSize(-5, 100, -5)).toBe(-5);
  });
});

// ─── safeJsonParse ────────────────────────────────────────────
describe('safeJsonParse()', () => {
  test('parses valid JSON string', () => {
    expect(safeJsonParse('{"key":"value"}', {})).toEqual({ key: 'value' });
    expect(safeJsonParse('42', 0)).toBe(42);
    expect(safeJsonParse('"hello"', '')).toBe('hello');
    expect(safeJsonParse('true', false)).toBe(true);
    expect(safeJsonParse('null', 'fallback')).toBeNull();
  });

  test('returns fallback for null input', () => {
    expect(safeJsonParse(null, 'fallback')).toBe('fallback');
    expect(safeJsonParse(null, 42)).toBe(42);
    expect(safeJsonParse(null, [])).toEqual([]);
    expect(safeJsonParse(null, {})).toEqual({});
  });

  test('returns fallback for empty string', () => {
    expect(safeJsonParse('', 'fallback')).toBe('fallback');
    expect(safeJsonParse('', [])).toEqual([]);
  });

  test('returns fallback for invalid JSON strings', () => {
    expect(safeJsonParse('not json', 'fallback')).toBe('fallback');
    expect(safeJsonParse('{broken', {})).toEqual({});
    expect(safeJsonParse('{"key": }', {})).toEqual({});
    expect(safeJsonParse('undefined', 'fallback')).toBe('fallback');
  });

  test('parses nested objects correctly', () => {
    const json = '{"a": {"b": {"c": 1}}, "d": [1, 2, 3]}';
    const result = safeJsonParse(json, {});
    expect(result).toEqual({ a: { b: { c: 1 } }, d: [1, 2, 3] });
  });

  test('parses arrays correctly', () => {
    expect(safeJsonParse('[1, 2, 3]', [])).toEqual([1, 2, 3]);
    expect(safeJsonParse('["a", "b"]', [])).toEqual(['a', 'b']);
    expect(safeJsonParse('[{"x": 1}]', [])).toEqual([{ x: 1 }]);
  });

  test('returns empty array fallback for non-array invalid input', () => {
    expect(safeJsonParse('invalid', [])).toEqual([]);
  });

  test('preserves type with generic', () => {
    interface Foo { bar: number }
    const result: Foo = safeJsonParse<Foo>('{"bar": 42}', { bar: 0 });
    expect(result.bar).toBe(42);
  });

  test('handles whitespace-only strings as falsy', () => {
    // Empty string is falsy → returns fallback
    expect(safeJsonParse('', 'default')).toBe('default');
  });

  test('returns fallback object when JSON is truncated', () => {
    expect(safeJsonParse('{"key"', { key: 'default' })).toEqual({ key: 'default' });
  });
});

// ─── validatePhone ────────────────────────────────────────────
describe('validatePhone()', () => {
  test('accepts valid 0555XXXXXXXX format', () => {
    expect(validatePhone('0555123456')).toBe(true);
    expect(validatePhone('0555000000')).toBe(true);
    expect(validatePhone('0555999999')).toBe(true);
  });

  test('accepts valid 0661XXXXXXXX format', () => {
    expect(validatePhone('0661234567')).toBe(true);
    expect(validatePhone('0661234568')).toBe(true);
    expect(validatePhone('0661000000')).toBe(true);
  });

  test('accepts valid 0770XXXXXXXX format', () => {
    expect(validatePhone('0770123456')).toBe(true);
    expect(validatePhone('0770000000')).toBe(true);
    expect(validatePhone('0770999999')).toBe(true);
  });

  test('accepts phones with spaces (spaces stripped)', () => {
    expect(validatePhone('0555 12 34 56')).toBe(true);
    expect(validatePhone('0661 23 45 67')).toBe(true);
    expect(validatePhone('0770 34 56 78')).toBe(true);
    expect(validatePhone('  0555123456  ')).toBe(true);
  });

  test('rejects invalid prefixes', () => {
    expect(validatePhone('0123456789')).toBe(false);  // 01
    expect(validatePhone('0234567890')).toBe(false);  // 02
    expect(validatePhone('0334567890')).toBe(false);  // 03
    expect(validatePhone('0434567890')).toBe(false);  // 04
    expect(validatePhone('0834567890')).toBe(false);  // 08
    expect(validatePhone('0934567890')).toBe(false);  // 09
  });

  test('rejects wrong length', () => {
    expect(validatePhone('055512345')).toBe(false);    // 9 digits
    expect(validatePhone('05551234567')).toBe(false);   // 11 digits
    expect(validatePhone('0555')).toBe(false);           // 4 digits
    expect(validatePhone('')).toBe(false);               // empty
  });

  test('rejects non-digit characters (after space stripping)', () => {
    expect(validatePhone('0555a23456')).toBe(false);
    expect(validatePhone('abc')).toBe(false);
    expect(validatePhone('+213555123456')).toBe(false);
    expect(validatePhone('phone')).toBe(false);
  });

  test('rejects empty input', () => {
    expect(validatePhone('')).toBe(false);
    expect(validatePhone('   ')).toBe(false);  // spaces only
  });

  test('accepts all valid prefixes in range 05-07', () => {
    expect(validatePhone('0500123456')).toBe(true);
    expect(validatePhone('0510123456')).toBe(true);
    expect(validatePhone('0600123456')).toBe(true);
    expect(validatePhone('0699123456')).toBe(true);
    expect(validatePhone('0700123456')).toBe(true);
    expect(validatePhone('0799123456')).toBe(true);
  });

  test('exactly 10 digits after space removal', () => {
    // 0555 123 456 → 0555123456 = 10 digits → valid
    expect(validatePhone('0555 123 456')).toBe(true);
    // 0555 1234 567 → 05551234567 = 11 digits → invalid
    expect(validatePhone('0555 1234 567')).toBe(false);
    // 0555 12 34 → 05551234 = 8 digits → invalid
    expect(validatePhone('0555 12 34')).toBe(false);
    // 0555 1234 5678 → 055512345678 = 11 digits → invalid
    expect(validatePhone('0555 1234 5678')).toBe(false);
  });
});
