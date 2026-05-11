import { describe, expect, it } from 'vitest';
import {
  encodeRRuleBodyFromLegacy,
  validateRecurrenceRuleBody,
  computeNextNFromRecurrence,
} from './distributionRecurrence.js';

describe('encodeRRuleBodyFromLegacy', () => {
  it('encodes Tuesday + Friday weekly', () => {
    const rr = encodeRRuleBodyFromLegacy({
      frequency: 'weekly',
      scheduleDay: 1,
      scheduleDays: null,
      scheduleWeekdays: [2, 5],
    });
    expect(rr).toContain('FREQ=WEEKLY');
    expect(rr).toContain('BYDAY=TU,FR');
  });

  it('encodes biweekly with multiple weekdays', () => {
    const rr = encodeRRuleBodyFromLegacy({
      frequency: 'biweekly',
      scheduleDay: 0,
      scheduleDays: null,
      scheduleWeekdays: [1, 3],
    });
    expect(rr).toContain('INTERVAL=2');
    expect(rr).toMatch(/BYDAY=MO,WE|BYDAY=WE,MO/);
  });
});

describe('validateRecurrenceRuleBody', () => {
  it('throws for empty rule', () => {
    expect(() => validateRecurrenceRuleBody('  ')).toThrow(/empty/);
  });

  it('throws for unsupported RRULE keys', () => {
    expect(() => validateRecurrenceRuleBody('FREQ=WEEKLY;BYMONTH=1')).toThrow(/Unsupported/);
  });

  it('accepts whitelisted weekly rule', () => {
    expect(() =>
      validateRecurrenceRuleBody('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR')
    ).not.toThrow();
  });
});

describe('computeNextNFromRecurrence', () => {
  it('expands Tue+Fr pattern', () => {
    const anchor = new Date('2026-05-11T12:00:00.000Z');
    const runs = computeNextNFromRecurrence({
      recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU,FR',
      recurrenceDtstart: anchor,
      count: 4,
      afterExclusive: new Date('2026-05-10T23:59:59.000Z'),
    });
    expect(runs.length).toBeGreaterThanOrEqual(2);
  });
});
