import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getDayOfWeekInTimeZone,
  isWeekendInTimeZone,
  normalizeSchedulerTimezone,
  shouldRunScheduledPostSyncInsights,
  shouldRunScheduledSync,
} from "./schedulerPolicy.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeSchedulerTimezone", () => {
  it("returns America/New_York for empty input", () => {
    expect(normalizeSchedulerTimezone("")).toBe("America/New_York");
    expect(normalizeSchedulerTimezone(null)).toBe("America/New_York");
  });

  it("falls back for invalid timezone", () => {
    expect(normalizeSchedulerTimezone("Not/A_Token")).toBe("America/New_York");
  });

  it("accepts valid IANA id", () => {
    expect(normalizeSchedulerTimezone("UTC")).toBe("UTC");
  });
});

describe("weekend in America/New_York", () => {
  // 2026-07-04 is Saturday; noon UTC → morning Eastern (still Sat)
  const saturdayUtc = new Date("2026-07-04T12:00:00.000Z");
  const sundayUtc = new Date("2026-07-05T12:00:00.000Z");
  const mondayUtc = new Date("2026-07-06T12:00:00.000Z");

  it("Saturday returns weekend", () => {
    expect(getDayOfWeekInTimeZone(saturdayUtc, "America/New_York")).toBe(6);
    expect(isWeekendInTimeZone(saturdayUtc, "America/New_York")).toBe(true);
  });

  it("Sunday returns weekend", () => {
    expect(getDayOfWeekInTimeZone(sundayUtc, "America/New_York")).toBe(0);
    expect(isWeekendInTimeZone(sundayUtc, "America/New_York")).toBe(true);
  });

  it("Monday is not weekend", () => {
    expect(getDayOfWeekInTimeZone(mondayUtc, "America/New_York")).toBe(1);
    expect(isWeekendInTimeZone(mondayUtc, "America/New_York")).toBe(false);
  });
});

describe("same UTC instant in multiple timezones", () => {
  it("returns valid day-of-week 0–6 for UTC and Tokyo", () => {
    const d = new Date("2026-01-01T10:00:00.000Z");
    const utcDow = getDayOfWeekInTimeZone(d, "UTC");
    const tokyoDow = getDayOfWeekInTimeZone(d, "Asia/Tokyo");
    expect(utcDow).toBeGreaterThanOrEqual(0);
    expect(utcDow).toBeLessThanOrEqual(6);
    expect(tokyoDow).toBeGreaterThanOrEqual(0);
    expect(tokyoDow).toBeLessThanOrEqual(6);
  });
});

describe("shouldRunScheduledSync", () => {
  const saturday = new Date("2026-07-04T12:00:00.000Z");

  it("returns false on weekend when businessDaysOnly", () => {
    expect(
      shouldRunScheduledSync({
        businessDaysOnly: true,
        timeZone: "America/New_York",
        now: saturday,
      }),
    ).toBe(false);
  });

  it("returns true on weekend when businessDaysOnly false", () => {
    expect(
      shouldRunScheduledSync({
        businessDaysOnly: false,
        timeZone: "America/New_York",
        now: saturday,
      }),
    ).toBe(true);
  });
});

describe("shouldRunScheduledPostSyncInsights", () => {
  const saturday = new Date("2026-07-04T12:00:00.000Z");

  it("manual trigger runs on weekend even when businessDaysOnly", () => {
    expect(
      shouldRunScheduledPostSyncInsights({
        trigger: "manual",
        businessDaysOnly: true,
        timeZone: "America/New_York",
        now: saturday,
      }),
    ).toBe(true);
  });

  it("scheduled trigger skips on weekend when businessDaysOnly", () => {
    expect(
      shouldRunScheduledPostSyncInsights({
        trigger: "scheduled",
        businessDaysOnly: true,
        timeZone: "America/New_York",
        now: saturday,
      }),
    ).toBe(false);
  });

  it("scheduled trigger runs on Monday when businessDaysOnly", () => {
    const monday = new Date("2026-07-06T12:00:00.000Z");
    expect(
      shouldRunScheduledPostSyncInsights({
        trigger: "scheduled",
        businessDaysOnly: true,
        timeZone: "America/New_York",
        now: monday,
      }),
    ).toBe(true);
  });
});
