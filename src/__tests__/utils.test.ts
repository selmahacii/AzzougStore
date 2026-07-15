import { test, expect, describe } from 'bun:test';
import { cn } from '@/lib/utils';

// ─── cn() ─────────────────────────────────────────────────────
describe('cn()', () => {
  test('merges multiple class strings', () => {
    expect(cn('text-red-500', 'bg-blue-200')).toBe('text-red-500 bg-blue-200');
  });

  test('handles single class name', () => {
    expect(cn('flex')).toBe('flex');
  });

  test('handles empty inputs', () => {
    expect(cn()).toBe('');
    expect(cn('')).toBe('');
    expect(cn('', '')).toBe('');
  });

  test('filters out undefined and null values', () => {
    expect(cn(undefined, 'flex', null)).toBe('flex');
    expect(cn(null, undefined)).toBe('');
  });

  test('filters out falsy values', () => {
    expect(cn(false && 'hidden', 'flex')).toBe('flex');
    expect(cn(0 && 'zero', 'block')).toBe('block');
    expect(cn('' && 'empty', 'inline')).toBe('inline');
  });

  test('handles conditional classes with ternary', () => {
    const isActive = true;
    const isDisabled = false;
    const result = cn('btn', isActive && 'active', isDisabled && 'disabled');
    expect(result).toBe('btn active');
  });

  test('deduplicates identical classes', () => {
    // tailwind-merge should dedupe
    const result = cn('p-4', 'p-4');
    expect(result).toBe('p-4');
  });

  test('resolves Tailwind CSS conflicts — later class wins', () => {
    // tailwind-merge resolves conflicting utility classes
    const result = cn('p-2', 'p-4');
    expect(result).toBe('p-4');
  });

  test('resolves px/py conflicts with p shorthand', () => {
    const result = cn('p-2', 'px-4');
    expect(result).toBe('p-2 px-4');
  });

  test('resolves text-size conflicts', () => {
    const result = cn('text-sm', 'text-lg');
    expect(result).toBe('text-lg');
  });

  test('resolves bg-color conflicts', () => {
    const result = cn('bg-red-500', 'bg-blue-500');
    expect(result).toBe('bg-blue-500');
  });

  test('handles array input via clsx', () => {
    const result = cn(['flex', 'items-center']);
    expect(result).toBe('flex items-center');
  });

  test('handles mixed array and string inputs', () => {
    const result = cn(['flex'], 'gap-2');
    expect(result).toBe('flex gap-2');
  });

  test('handles object input via clsx', () => {
    const result = cn({ 'text-red': true, 'text-blue': false, hidden: true });
    expect(result).toBe('text-red hidden');
  });

  test('combines object and string inputs', () => {
    const result = cn('base-class', { active: true, disabled: false });
    expect(result).toBe('base-class active');
  });

  test('complex real-world scenario: button classes', () => {
    const variant = 'primary';
    const classes = cn(
      'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium',
      variant === 'primary' && 'bg-emerald-600 text-white hover:bg-emerald-700',
      variant === 'secondary' && 'bg-gray-100 text-gray-900',
    );
    expect(classes).toContain('inline-flex');
    expect(classes).toContain('bg-emerald-600');
    expect(classes).not.toContain('bg-gray-100');
  });

  test('handles string with spaces (multiple classes in one arg)', () => {
    const result = cn('flex  items-center  gap-4');
    // clsx handles multiple spaces; result should be clean
    expect(result).toContain('flex');
    expect(result).toContain('items-center');
    expect(result).toContain('gap-4');
  });

  test('returns a string', () => {
    expect(typeof cn('test')).toBe('string');
    expect(typeof cn()).toBe('string');
  });
});
