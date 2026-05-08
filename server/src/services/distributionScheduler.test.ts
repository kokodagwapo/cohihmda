import { describe, expect, it } from 'vitest';
import {
  computeNextRunAt,
  normalizeMonthlyDays,
} from './distributionScheduler.js';

describe('normalizeMonthlyDays', () => {
  it('sorts unique integers in 1..31', () => {
    expect(normalizeMonthlyDays([31, 15, 15, 99], null)).toEqual([15, 31]);
  });

  it('falls back to legacy schedule_day', () => {
    expect(normalizeMonthlyDays(null, 7)).toEqual([7]);
  });
});

describe('computeNextRunAt monthly (multi-day)', () => {
  it('picks earliest future occurrence among selected days in UTC', () => {
    const after = new Date('2026-05-10T15:00:00.000Z');
    const next = computeNextRunAt(
      'monthly',
      '09:00',
      null,
      'UTC',
      [1, 15],
      after
    );
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe('2026-05-15T09:00:00.000Z');
  });

  it('clamps 30 and 31 to last day in February and dedupes same instant', () => {
    const after = new Date('2027-01-31T12:00:00.000Z');
    const next = computeNextRunAt(
      'monthly',
      '08:00',
      null,
      'UTC',
      [30, 31],
      after
    );
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe('2027-02-28T08:00:00.000Z');
  });

  it('handles leap year February for day 29', () => {
    const after = new Date('2024-02-01T12:00:00.000Z');
    const next = computeNextRunAt(
      'monthly',
      '12:00',
      null,
      'UTC',
      [29],
      after
    );
    expect(next!.toISOString()).toBe('2024-02-29T12:00:00.000Z');
  });

  it('resolves monthly runs in America/New_York without throwing', () => {
    const next = computeNextRunAt(
      'monthly',
      '09:00',
      null,
      'America/New_York',
      [15],
      new Date('2026-06-01T12:00:00.000Z')
    );
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(new Date('2026-06-01T12:00:00.000Z').getTime());
  });
});

describe('computeNextRunAt monthly chaining', () => {
  it('advances to next month when using afterExclusive', () => {
    const first = computeNextRunAt(
      'monthly',
      '10:00',
      null,
      'UTC',
      [15],
      new Date('2026-03-20T12:00:00.000Z')
    );
    expect(first!.toISOString()).toBe('2026-04-15T10:00:00.000Z');
    const second = computeNextRunAt(
      'monthly',
      '10:00',
      null,
      'UTC',
      [15],
      new Date(first!.getTime() + 1)
    );
    expect(second!.toISOString()).toBe('2026-05-15T10:00:00.000Z');
  });
});
