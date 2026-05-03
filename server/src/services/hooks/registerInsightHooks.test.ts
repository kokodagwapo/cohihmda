import { describe, expect, it } from "vitest";
import {
  loadPostSyncInsightPolicy,
  shouldRunInsightHookForPolicy,
} from "./registerInsightHooks.js";
import type { PostSyncContext } from "./postSyncHookService.js";

describe("@COHI-351 scheduled insight weekend policy", () => {
  it("loads policy fields used by prediction, agent, and tracked hooks", async () => {
    const ctx: PostSyncContext = {
      tenantId: "tenant-cohi-351",
      tenantPool: {
        query: async () => ({
          rows: [
            {
              insights_auto_enabled: true,
              insights_business_days_only: true,
              scheduler_timezone: "America/Chicago",
            },
          ],
        }),
      } as any,
      connectionId: "los-conn-351",
      syncType: "encompass",
      recordsSynced: 5,
      trigger: "scheduled",
    };

    await expect(loadPostSyncInsightPolicy(ctx)).resolves.toEqual({
      insightsAutoEnabled: true,
      insightsBusinessDaysOnly: true,
      schedulerTimezone: "America/Chicago",
    });
  });

  it("skips scheduled-trigger insight hooks on weekends when configured", () => {
    expect(
      shouldRunInsightHookForPolicy({
        trigger: "scheduled",
        scheduledInsightsEnabled: true,
        now: new Date("2026-07-04T12:00:00.000Z"), // Saturday
        policy: {
          insightsAutoEnabled: true,
          insightsBusinessDaysOnly: true,
          schedulerTimezone: "America/New_York",
        },
      }),
    ).toBe(false);
  });

  it("skips scheduled-trigger insight hooks when the matched run time does not enable insights", () => {
    expect(
      shouldRunInsightHookForPolicy({
        trigger: "scheduled",
        scheduledInsightsEnabled: false,
        now: new Date("2026-07-06T12:00:00.000Z"), // Monday
        policy: {
          insightsAutoEnabled: true,
          insightsBusinessDaysOnly: false,
          schedulerTimezone: "America/New_York",
        },
      }),
    ).toBe(false);
  });

  it("allows manual-trigger insight hooks on weekends when insights_auto_enabled is true", () => {
    expect(
      shouldRunInsightHookForPolicy({
        trigger: "manual",
        now: new Date("2026-07-04T12:00:00.000Z"), // Saturday
        policy: {
          insightsAutoEnabled: true,
          insightsBusinessDaysOnly: true,
          schedulerTimezone: "America/New_York",
        },
      }),
    ).toBe(true);
  });

  it("allows scheduled-trigger insight hooks when the matched run time enables insights", () => {
    expect(
      shouldRunInsightHookForPolicy({
        trigger: "scheduled",
        scheduledInsightsEnabled: true,
        now: new Date("2026-07-06T12:00:00.000Z"), // Monday
        policy: {
          insightsAutoEnabled: true,
          insightsBusinessDaysOnly: false,
          schedulerTimezone: "America/New_York",
        },
      }),
    ).toBe(true);
  });

  it("skips all heavy insight hooks when insights_auto_enabled is false", () => {
    expect(
      shouldRunInsightHookForPolicy({
        trigger: "manual",
        now: new Date("2026-07-06T12:00:00.000Z"), // Monday
        policy: {
          insightsAutoEnabled: false,
          insightsBusinessDaysOnly: false,
          schedulerTimezone: "America/New_York",
        },
      }),
    ).toBe(false);
  });
});
