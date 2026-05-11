/**
 * RFC 5545 RRULE helpers for distribution_schedules.
 * recurrence_rule stores the RRULE line only (no DTSTART); recurrence_dtstart is the anchor UTC instant.
 */

import { DateTime } from 'luxon';
import rrulePkg from 'rrule';
import type { Options } from 'rrule';

/** Node ESM loads rrule's CJS build: named exports are on default, not top-level. */
const { RRule, RRuleSet } = rrulePkg as {
  RRule: typeof import('rrule').RRule;
  RRuleSet: typeof import('rrule').RRuleSet;
};

const DOW_TO_BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

function normalizeMonthlyDaysLocal(
  scheduleDays: number[] | null | undefined,
  scheduleDay: number | null
): number[] | null {
  if (Array.isArray(scheduleDays) && scheduleDays.length > 0) {
    const nums = [
      ...new Set(
        scheduleDays
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31)
      ),
    ].sort((a, b) => a - b);
    return nums.length ? nums : null;
  }
  if (scheduleDay != null) {
    return [Math.max(1, Math.min(31, scheduleDay))];
  }
  return null;
}

const RRULE_ALLOWED_KEYS = new Set([
  'freq',
  'interval',
  'until',
  'count',
  'wkst',
  'byweekday',
  'bymonthday',
]);

function formatYmdInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function parseYmd(s: string): { y: number; m: number; d: number } {
  const parts = s.split('-').map((x) => parseInt(x, 10));
  return { y: parts[0]!, m: parts[1]! - 1, d: parts[2]! };
}

/** Wall-clock time on the local calendar day of anchorDate in IANA timezone → UTC Date. */
export function buildRecurrenceDtstart(
  timezone: string,
  scheduleTime: string,
  anchorDate: Date
): Date {
  const tz = timezone || 'America/New_York';
  const ymd = formatYmdInTz(anchorDate, tz);
  const { y, m, d } = parseYmd(ymd);
  const [hh, mm] = scheduleTime.split(':').map((s) => parseInt(s, 10) || 0);
  return DateTime.fromObject(
    { year: y, month: m + 1, day: d, hour: hh, minute: mm, second: 0 },
    { zone: tz }
  ).toJSDate();
}

export function normalizeWeekdaysList(
  weekdays: number[] | null | undefined,
  fallbackSingle: number | null | undefined
): number[] {
  if (Array.isArray(weekdays) && weekdays.length > 0) {
    return [
      ...new Set(
        weekdays
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
      ),
    ].sort((a, b) => a - b);
  }
  if (fallbackSingle != null && !Number.isNaN(Number(fallbackSingle))) {
    return [Math.max(0, Math.min(6, Number(fallbackSingle)))];
  }
  return [];
}

/** RRULE line only (no DTSTART), built from legacy frequency fields. */
export function encodeRRuleBodyFromLegacy(params: {
  frequency: string;
  scheduleDay: number | null;
  scheduleDays: number[] | null;
  scheduleWeekdays: number[] | null;
}): string {
  const { frequency, scheduleDay, scheduleDays, scheduleWeekdays } = params;
  if (frequency === 'one_time') return 'FREQ=DAILY;INTERVAL=1';
  if (frequency === 'daily') return 'FREQ=DAILY;INTERVAL=1';
  if (frequency === 'weekly') {
    const wds = normalizeWeekdaysList(scheduleWeekdays, scheduleDay);
    if (!wds.length) return 'FREQ=DAILY;INTERVAL=1';
    const by = wds.map((n) => DOW_TO_BYDAY[n]).join(',');
    return `FREQ=WEEKLY;INTERVAL=1;BYDAY=${by}`;
  }
  if (frequency === 'biweekly') {
    const wds = normalizeWeekdaysList(scheduleWeekdays, scheduleDay);
    if (!wds.length) return 'FREQ=DAILY;INTERVAL=1';
    const by = wds.map((n) => DOW_TO_BYDAY[n]).join(',');
    return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${by}`;
  }
  if (frequency === 'monthly') {
    const md = normalizeMonthlyDaysLocal(scheduleDays, scheduleDay);
    if (!md?.length) return 'FREQ=DAILY;INTERVAL=1';
    return `FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${md.join(',')}`;
  }
  return 'FREQ=DAILY;INTERVAL=1';
}

export function validateRecurrenceRuleBody(rule: string): void {
  const trimmed = rule.trim();
  if (!trimmed) {
    throw new Error('recurrence_rule is empty');
  }
  let parsed: Partial<Options>;
  try {
    parsed = RRule.parseString(trimmed);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid recurrence_rule: ${msg}`);
  }
  for (const key of Object.keys(parsed)) {
    if (!RRULE_ALLOWED_KEYS.has(key.toLowerCase())) {
      throw new Error(`Unsupported recurrence feature: ${key}`);
    }
  }
}

function parseExdates(v: unknown): Date[] {
  if (!v || !Array.isArray(v)) return [];
  return v
    .map((x) => new Date(String(x)))
    .filter((d) => !Number.isNaN(d.getTime()));
}

function buildRuleSet(
  recurrenceRule: string,
  recurrenceDtstart: Date,
  recurrenceExdates: Date[]
): InstanceType<typeof RRule> | InstanceType<typeof RRuleSet> {
  const parsed = RRule.parseString(recurrenceRule.trim());
  const rule = new RRule({ ...parsed, dtstart: recurrenceDtstart });
  if (!recurrenceExdates.length) return rule;
  const set = new RRuleSet();
  set.rrule(rule);
  for (const ex of recurrenceExdates) {
    set.exdate(ex);
  }
  return set;
}

/** Next occurrence strictly after afterExclusive, or null. */
export function computeNextFromRecurrence(params: {
  recurrenceRule: string | null | undefined;
  recurrenceDtstart: Date | string | null | undefined;
  recurrenceExdates?: unknown;
  afterExclusive: Date;
}): Date | null {
  const ruleStr = params.recurrenceRule?.trim();
  const dt0 = params.recurrenceDtstart;
  if (!ruleStr || dt0 == null) return null;
  const dtstart = dt0 instanceof Date ? dt0 : new Date(dt0);
  if (Number.isNaN(dtstart.getTime())) return null;
  try {
    const ex = parseExdates(params.recurrenceExdates);
    const engine = buildRuleSet(ruleStr, dtstart, ex);
    return engine.after(params.afterExclusive, false);
  } catch {
    return null;
  }
}

export function computeNextNFromRecurrence(params: {
  recurrenceRule: string | null | undefined;
  recurrenceDtstart: Date | string | null | undefined;
  recurrenceExdates?: unknown;
  count: number;
  afterExclusive?: Date | null;
}): Date[] {
  const floor = params.afterExclusive ?? new Date();
  const out: Date[] = [];
  let ref = new Date(floor.getTime());
  for (let i = 0; i < params.count; i++) {
    const next = computeNextFromRecurrence({
      recurrenceRule: params.recurrenceRule,
      recurrenceDtstart: params.recurrenceDtstart,
      recurrenceExdates: params.recurrenceExdates,
      afterExclusive: ref,
    });
    if (!next) break;
    out.push(next);
    ref = new Date(next.getTime() + 1);
  }
  return out;
}

/**
 * Anchor dtstart for RRULE weekly/biweekly: first weekly occurrence from start-of-anchor-day,
 * then step back one week so the next `after(anchor)` matches intuitive "next slot" cadence.
 */
export function buildPersistedDtstart(
  frequency: string,
  scheduleTime: string,
  timezone: string,
  scheduleDay: number | null,
  scheduleDays: number[] | null,
  scheduleWeekdays: number[] | null,
  anchorDate: Date
): Date | null {
  const tz = timezone || 'America/New_York';
  if (frequency === 'one_time') return null;
  if (frequency === 'daily' || frequency === 'monthly') {
    return buildRecurrenceDtstart(tz, scheduleTime, anchorDate);
  }
  const weeklyRr = encodeRRuleBodyFromLegacy({
    frequency: 'weekly',
    scheduleDay,
    scheduleDays,
    scheduleWeekdays,
  });
  const tentative = buildRecurrenceDtstart(tz, scheduleTime, anchorDate);
  const startOfDay = buildRecurrenceDtstart(tz, '00:00', anchorDate);
  const nextW = computeNextFromRecurrence({
    recurrenceRule: weeklyRr,
    recurrenceDtstart: tentative,
    afterExclusive: new Date(startOfDay.getTime() - 1),
  });
  if (!nextW) {
    return buildRecurrenceDtstart(tz, scheduleTime, anchorDate);
  }
  return DateTime.fromJSDate(nextW, { zone: tz }).minus({ weeks: 1 }).toJSDate();
}
