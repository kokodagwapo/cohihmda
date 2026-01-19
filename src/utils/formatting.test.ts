import { describe, it, expect } from 'vitest';
import { formatCompactNumber, formatCompactNumberNoCurrency } from './formatting';

describe('formatCompactNumber', () => {
  it('should format billions correctly', () => {
    expect(formatCompactNumber(1_000_000_000)).toBe('$1.0B');
    expect(formatCompactNumber(1_500_000_000)).toBe('$1.5B');
    expect(formatCompactNumber(2_345_000_000)).toBe('$2.3B');
  });

  it('should format millions correctly', () => {
    expect(formatCompactNumber(1_000_000)).toBe('$1.0M');
    expect(formatCompactNumber(5_500_000)).toBe('$5.5M');
    expect(formatCompactNumber(999_999_999)).toBe('$1000.0M'); // Rounds up to next threshold
  });

  it('should format thousands correctly', () => {
    expect(formatCompactNumber(1_000)).toBe('$1.0K');
    expect(formatCompactNumber(5_500)).toBe('$5.5K');
    expect(formatCompactNumber(999_999)).toBe('$1000.0K'); // Rounds up to next threshold
  });

  it('should format numbers less than 1000 correctly', () => {
    expect(formatCompactNumber(0)).toBe('$0');
    expect(formatCompactNumber(100)).toBe('$100');
    expect(formatCompactNumber(999)).toBe('$999');
  });

  it('should handle decimal values correctly', () => {
    expect(formatCompactNumber(1_234_567)).toBe('$1.2M');
    expect(formatCompactNumber(5_678_901)).toBe('$5.7M');
  });

  it('should handle edge cases', () => {
    expect(formatCompactNumber(999)).toBe('$999');
    expect(formatCompactNumber(1_000)).toBe('$1.0K');
    expect(formatCompactNumber(999_999)).toBe('$1000.0K');
    expect(formatCompactNumber(1_000_000)).toBe('$1.0M');
    expect(formatCompactNumber(999_999_999)).toBe('$1000.0M');
    expect(formatCompactNumber(1_000_000_000)).toBe('$1.0B');
  });
});

describe('formatCompactNumberNoCurrency', () => {
  it('should format millions correctly without currency symbol', () => {
    expect(formatCompactNumberNoCurrency(1_000_000)).toBe('1.0M');
    expect(formatCompactNumberNoCurrency(5_500_000)).toBe('5.5M');
    expect(formatCompactNumberNoCurrency(999_999_999)).toBe('1000.0M');
  });

  it('should format thousands correctly without currency symbol', () => {
    expect(formatCompactNumberNoCurrency(1_000)).toBe('1K');
    expect(formatCompactNumberNoCurrency(5_500)).toBe('6K'); // Rounds up with toFixed(0)
    expect(formatCompactNumberNoCurrency(4_500)).toBe('5K'); // Rounds up
    expect(formatCompactNumberNoCurrency(999_999)).toBe('1000K');
  });

  it('should format numbers less than 1000 correctly without currency symbol', () => {
    expect(formatCompactNumberNoCurrency(0)).toBe('0');
    expect(formatCompactNumberNoCurrency(100)).toBe('100');
    expect(formatCompactNumberNoCurrency(999)).toBe('999');
  });

  it('should handle decimal values correctly', () => {
    expect(formatCompactNumberNoCurrency(1_234_567)).toBe('1.2M');
    expect(formatCompactNumberNoCurrency(5_678_901)).toBe('5.7M');
  });

  it('should handle edge cases', () => {
    expect(formatCompactNumberNoCurrency(999)).toBe('999');
    expect(formatCompactNumberNoCurrency(1_000)).toBe('1K');
    expect(formatCompactNumberNoCurrency(999_999)).toBe('1000K');
    expect(formatCompactNumberNoCurrency(1_000_000)).toBe('1.0M');
  });

  it('should not include currency symbol', () => {
    const result = formatCompactNumberNoCurrency(1_000_000);
    expect(result).not.toContain('$');
    expect(result).toBe('1.0M');
  });
});

