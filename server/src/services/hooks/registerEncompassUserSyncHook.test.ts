import { afterEach, describe, expect, it, vi } from "vitest";
import type { PostSyncContext } from "./postSyncHookService.js";

const { createSvcMock, syncUsersMock } = vi.hoisted(() => ({
  createSvcMock: vi.fn(),
  syncUsersMock: vi.fn(),
}));

vi.mock("../encompassUserSyncService.js", () => ({
  createEncompassUserSyncService: createSvcMock,
}));

async function loadHook() {
  return import("./registerEncompassUserSyncHook.js");
}

function ctxWithPolicy(policy: Record<string, unknown>): PostSyncContext {
  const tenantPool = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("SELECT encompass_users_sync_enabled")) {
        return { rows: [policy] };
      }
      return { rows: [] };
    }),
  } as any;

  return {
    tenantId: "tenant-cohi-351",
    tenantPool,
    connectionId: "los-conn-351",
    syncType: "encompass",
    recordsSynced: 10,
    trigger: "scheduled",
  };
}

describe("@COHI-351 Encompass user cache post-sync hook", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.ENCOMPASS_USER_SYNC_MIN_INTERVAL_HOURS;
  });

  it("runs syncUsers and updates last_encompass_users_sync_at when enabled", async () => {
    syncUsersMock.mockResolvedValue({
      success: true,
      users_fetched: 2,
      users_added: 1,
      users_updated: 1,
      users_disabled: 0,
      duration_ms: 10,
    });
    createSvcMock.mockReturnValue({ syncUsers: syncUsersMock });
    const ctx = ctxWithPolicy({
      encompass_users_sync_enabled: true,
      last_encompass_users_sync_at: null,
    });

    const { runEncompassUserCacheSyncHook } = await loadHook();
    await runEncompassUserCacheSyncHook(ctx);

    expect(createSvcMock).toHaveBeenCalledWith(ctx.tenantPool, "tenant-cohi-351");
    expect(syncUsersMock).toHaveBeenCalledWith("los-conn-351");
    expect(ctx.tenantPool.query).toHaveBeenCalledWith(
      expect.stringContaining("last_encompass_users_sync_at = NOW()"),
      ["los-conn-351"],
    );
  });

  it("does not call syncUsers when encompass_users_sync_enabled is false", async () => {
    const ctx = ctxWithPolicy({
      encompass_users_sync_enabled: false,
      last_encompass_users_sync_at: null,
    });

    const { runEncompassUserCacheSyncHook } = await loadHook();
    await runEncompassUserCacheSyncHook(ctx);

    expect(createSvcMock).not.toHaveBeenCalled();
    expect(syncUsersMock).not.toHaveBeenCalled();
  });

  it("logs and resolves when syncUsers fails so completed loan sync is not failed", async () => {
    syncUsersMock.mockRejectedValue(new Error("Encompass users API unavailable"));
    createSvcMock.mockReturnValue({ syncUsers: syncUsersMock });
    const ctx = ctxWithPolicy({
      encompass_users_sync_enabled: true,
      last_encompass_users_sync_at: null,
    });

    const { runEncompassUserCacheSyncHook } = await loadHook();
    await expect(runEncompassUserCacheSyncHook(ctx)).resolves.toBeUndefined();
    expect(syncUsersMock).toHaveBeenCalledWith("los-conn-351");
  });
});
