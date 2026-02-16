import { describe, it, expect } from 'vitest';
import {
  getUrgencyColor,
  getUrgencyDot,
  getAnimatedValue,
  getSmoothProgress,
  getFilteredKPI,
} from './dashboardHelpers';

// ============================================================================
// getUrgencyColor
// ============================================================================
describe('getUrgencyColor', () => {
  it('should return red classes for critical', () => {
    const result = getUrgencyColor('critical');
    expect(result).toContain('red');
  });

  it('should return orange classes for high', () => {
    const result = getUrgencyColor('high');
    expect(result).toContain('orange');
  });

  it('should return yellow classes for medium', () => {
    const result = getUrgencyColor('medium');
    expect(result).toContain('yellow');
  });

  it('should return blue classes for low', () => {
    const result = getUrgencyColor('low');
    expect(result).toContain('blue');
  });

  it('should return gray classes for unknown urgency', () => {
    const result = getUrgencyColor('unknown');
    expect(result).toContain('gray');
  });
});

// ============================================================================
// getUrgencyDot
// ============================================================================
describe('getUrgencyDot', () => {
  it('should return correct dot colors', () => {
    expect(getUrgencyDot('critical')).toBe('bg-red-500');
    expect(getUrgencyDot('high')).toBe('bg-orange-500');
    expect(getUrgencyDot('medium')).toBe('bg-yellow-500');
    expect(getUrgencyDot('low')).toBe('bg-blue-500');
    expect(getUrgencyDot('unknown')).toBe('bg-gray-500');
  });
});

// ============================================================================
// getAnimatedValue
// ============================================================================
describe('getAnimatedValue', () => {
  it('should return real value when not animating', () => {
    expect(getAnimatedValue(100, 0, false)).toBe(100);
    expect(getAnimatedValue(500, 3, false)).toBe(500);
  });

  it('should return a value <= realValue when animating', () => {
    // Due to randomness, test multiple times
    for (let i = 0; i < 10; i++) {
      const result = getAnimatedValue(100, 3, true);
      expect(result).toBeLessThanOrEqual(100);
      expect(result).toBeGreaterThanOrEqual(0);
    }
  });

  it('should return 0 for zero real value', () => {
    expect(getAnimatedValue(0, 3, true)).toBe(0);
    expect(getAnimatedValue(0, 3, false)).toBe(0);
  });
});

// ============================================================================
// getSmoothProgress
// ============================================================================
describe('getSmoothProgress', () => {
  it('should return 1 when not animating', () => {
    expect(getSmoothProgress(0, false)).toBe(1);
    expect(getSmoothProgress(5, false)).toBe(1);
  });

  it('should return 0 at start of animation', () => {
    expect(getSmoothProgress(0, true)).toBe(0);
  });

  it('should return 1 at end of animation (cycle 5)', () => {
    const result = getSmoothProgress(5, true);
    expect(result).toBeCloseTo(1, 1);
  });

  it('should increase monotonically during animation', () => {
    let prev = 0;
    for (let cycle = 0; cycle <= 5; cycle += 0.5) {
      const current = getSmoothProgress(cycle, true);
      expect(current).toBeGreaterThanOrEqual(prev);
      prev = current;
    }
  });
});

// ============================================================================
// getFilteredKPI
// ============================================================================
describe('getFilteredKPI', () => {
  it('should return filtered data for known report and date filter', () => {
    const original = { value: 999, change: '0%' };
    const result = getFilteredKPI('1', 0, original, 'today');
    expect(result.value).toBe(47);
    expect(result.change).toBe('+12%');
  });

  it('should return original KPI for unknown report', () => {
    const original = { value: 999, change: '0%' };
    const result = getFilteredKPI('99', 0, original, 'today');
    expect(result).toEqual(original);
  });

  it('should return original KPI for custom date filter', () => {
    const original = { value: 999, change: '0%' };
    const result = getFilteredKPI('1', 0, original, 'custom');
    expect(result).toEqual(original);
  });

  it('should merge filtered values with original KPI properties', () => {
    const original = { value: 999, change: '0%', label: 'Loans Locked', icon: 'lock' };
    const result = getFilteredKPI('1', 0, original, 'mtd');
    expect(result.value).toBe(1247);
    expect(result.change).toBe('+8%');
    expect(result.label).toBe('Loans Locked');
    expect(result.icon).toBe('lock');
  });

  it('should handle different report IDs and KPI indices', () => {
    const original = { value: 0, change: '' };
    // Report 2 (Fallout & Risk), KPI 1 (Declinations)
    const result = getFilteredKPI('2', 1, original, 'ytd');
    expect(result.value).toBe(1640);
    expect(result.change).toBe('-3%');
  });
});
