import { afterEach, describe, expect, it, vi } from "vitest";
import { getConnectionsToSync } from "./losSyncScheduler.js";

const tenantId = "tenant-cohi-351";

function fakeTenantPool(rows: any[]) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as any;
}

describe("@COHI-351 LOS scheduler business-day policy", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips an overdue scheduler job on weekend when sync_business_days_only is enabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T12:00:00.000Z")); // Saturday in America/New_York

    const jobs = await getConnectionsToSync(
      tenantId,
      fakeTenantPool([
        {
          id: "conn-weekend-skip",
          connection_method: "api",
          los_type: "encompass",
          sync_frequency: "hourly",
          last_synced_at: new Date("2026-07-03T00:00:00.000Z"),
          last_loan_modified_at: null,
          encompass_selected_folders: [],
          encompass_users_sync_enabled: true,
          sync_business_days_only: true,
          insights_business_days_only: false,
          scheduler_timezone: "America/New_York",
          last_encompass_users_sync_at: null,
        },
      ]),
    );

    expect(jobs).toEqual([]);
  });

  it("does not skip an overdue weekend scheduler job when sync_business_days_only is disabled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T12:00:00.000Z")); // Saturday in America/New_York

    const jobs = await getConnectionsToSync(
      tenantId,
      fakeTenantPool([
        {
          id: "conn-weekend-run",
          connection_method: "api",
          los_type: "encompass",
          sync_frequency: "hourly",
          last_synced_at: new Date("2026-07-03T00:00:00.000Z"),
          last_loan_modified_at: null,
          encompass_selected_folders: [],
          encompass_users_sync_enabled: true,
          sync_business_days_only: false,
          insights_business_days_only: false,
          scheduler_timezone: "America/New_York",
          last_encompass_users_sync_at: null,
        },
      ]),
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      connectionId: "conn-weekend-run",
      schedulerTimezone: "America/New_York",
      syncBusinessDaysOnly: false,
    });
  });
});
