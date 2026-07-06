import { test, expect, describe } from 'bun:test';
import { formatPrice, hashString } from '@/lib/format';

// ─── formatPrice ──────────────────────────────────────────────
describe('formatPrice()', () => {
  test('formats zero correctly', () => {
    expect(formatPrice(0)).toBe('0 DA');
  });

  test('formats small integers correctly', () => {
    expect(formatPrice(1)).toBe('1 DA');
    expect(formatPrice(99)).toBe('99 DA');
    expect(formatPrice(100)).toBe('100 DA');
    expect(formatPrice(999)).toBe('999 DA');
  });

  test('formats large numbers with French locale spacing', () => {
    // French locale uses narrow non-breaking space (U+202F) or non-breaking space (U+00A0) as thousands separator
    const result = formatPrice(1000);
    expect(result).toContain('1');
    expect(result).toContain('DA');
    // Accept either NBSP or narrow NBSP depending on runtime
    expect(result).toMatch(/1\s000\sDA/);
  });

  test('formats very large numbers', () => {
    const result = formatPrice(185000);
    expect(result).toMatch(/185\s000\sDA/);
  });

  test('formats prices with decimal amounts (truncated to int)', () => {
    // The formatter uses minimumFractionDigits=0, maximumFractionDigits=0
    expect(formatPrice(1500.99)).toMatch(/1\s501\sDA/); // rounds
    expect(formatPrice(1500.50)).toMatch(/1\s501\sDA/); // rounds half-up
    expect(formatPrice(1500.49)).toMatch(/1\s500\sDA/); // rounds down
  });

  test('handles negative numbers', () => {
    // Intl.NumberFormat handles negative with minus sign
    const result = formatPrice(-500);
    expect(result).toContain('DA');
    expect(result).toMatch(/-.*500.*DA/);
  });

  test('always ends with " DA"', () => {
    expect(formatPrice(0)).toEndWith(' DA');
    expect(formatPrice(1)).toEndWith(' DA');
    expect(formatPrice(1000000)).toEndWith(' DA');
    expect(formatPrice(-100)).toEndWith(' DA');
  });

  test('returns a string type', () => {
    expect(typeof formatPrice(100)).toBe('string');
  });

  test('formats realistic Algerian Dinar prices', () => {
    // Common price points in Algerian e-commerce
    expect(formatPrice(3500)).toMatch(/3\s500\sDA/);    // phone case
    expect(formatPrice(185000)).toMatch(/185\s000\sDA/); // furniture
    expect(formatPrice(12000)).toMatch(/12\s000\sDA/);   // jewelry
  });

  test('handles extremely large numbers', () => {
    const result = formatPrice(999999999);
    expect(result).toMatch(/999\s999\s999\sDA/);
  });
});

// ─── hashString ───────────────────────────────────────────────
describe('hashString()', () => {
  test('returns a number', () => {
    expect(typeof hashString('hello')).toBe('number');
  });

  test('is deterministic — same input always gives same output', () => {
    const a = hashString('test');
    const b = hashString('test');
    const c = hashString('test');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  test('different inputs produce different hashes', () => {
    expect(hashString('a')).not.toBe(hashString('b'));
    expect(hashString('hello')).not.toBe(hashString('world'));
    expect(hashString('abc')).not.toBe(hashString('cba'));
  });

  test('returns non-negative number', () => {
    expect(hashString('anything')).toBeGreaterThanOrEqual(0);
    expect(hashString('')).toBeGreaterThanOrEqual(0);
    expect(hashString('x'.repeat(1000))).toBeGreaterThanOrEqual(0);
  });

  test('empty string produces a hash', () => {
    const result = hashString('');
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(0);
    // Empty string should consistently hash
    expect(hashString('')).toBe(result);
  });

  test('handles unicode strings', () => {
    const result1 = hashString('café');
    const result2 = hashString('مرحبا'); // Arabic
    const result3 = hashString('日本語');  // Japanese
    const result4 = hashString('émoji 🎉');
    expect(typeof result1).toBe('number');
    expect(typeof result2).toBe('number');
    expect(typeof result3).toBe('number');
    expect(typeof result4).toBe('number');
  });

  test('unicode hashing is deterministic', () => {
    expect(hashString('café')).toBe(hashString('café'));
    expect(hashString('مرحبا')).toBe(hashString('مرحبا'));
  });

  test('handles long strings', () => {
    const longStr = 'a'.repeat(10000);
    const result = hashString(longStr);
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(hashString(longStr)).toBe(result); // deterministic
  });

  test('handles strings with special characters', () => {
    expect(typeof hashString('a\nb\tc')).toBe('number');
    expect(typeof hashString('<script>alert(1)</script>')).toBe('number');
    expect(typeof hashString('null')).toBe('number');
    expect(typeof hashString('undefined')).toBe('number');
  });

  test('case-sensitive hashing', () => {
    expect(hashString('Hello')).not.toBe(hashString('hello'));
    expect(hashString('ABC')).not.toBe(hashString('abc'));
  });
});
