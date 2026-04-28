import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SyncManagementSection } from "@/components/admin/SyncManagementSection";
import { renderWithProviders } from "@/test/render";

const { requestMock, toastMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    request: requestMock,
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

const connection = {
  id: "los-conn-351",
  name: "Production Encompass",
  los_type: "encompass",
  connection_method: "api",
  sync_enabled: true,
  sync_frequency: "hourly",
  last_synced_at: null,
  last_sync_status: null,
  last_sync_error: null,
  last_loan_modified_at: null,
  is_active: true,
  insights_auto_enabled: true,
  podcast_auto_enabled: true,
  encompass_users_sync_enabled: true,
  sync_business_days_only: false,
  insights_business_days_only: false,
  scheduler_timezone: "America/New_York",
  last_encompass_users_sync_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  tenant_id: "tenant-cohi-351",
  tenant_name: "Cohi Test Tenant",
  tenant_slug: "cohi-test",
  loan_count: 42,
};

describe("@COHI-351 SyncManagementSection scheduler controls", () => {
  beforeEach(() => {
    requestMock.mockReset();
    toastMock.mockReset();
    requestMock.mockImplementation(async (url: string, options?: { method?: string }) => {
      if (url === "/api/admin/sync-management") {
        return {
          connections: [connection],
          scheduler: {
            interval_minutes: 15,
            next_run_estimate: "2026-01-01T00:15:00.000Z",
          },
          total_tenants: 1,
          tenants: [{ id: connection.tenant_id, name: connection.tenant_name, slug: connection.tenant_slug }],
          podcast: { nightly_enabled: false, nightly_last_run_at: null },
        };
      }
      if (options?.method === "PUT") {
        return { connection };
      }
      if (url.includes("/history")) return { history: [] };
      if (url.includes("/hook-status")) return { hookRuns: [] };
      return {};
    });
  });

  it("renders COHI-351 scheduler controls and updates business-day loan sync", async () => {
    renderWithProviders(<SyncManagementSection />);

    expect(await screen.findByText("Production Encompass")).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("Sync history"));

    expect(await screen.findByText("Sync Encompass users after loan sync")).toBeInTheDocument();
    expect(screen.getByText("Run automatic loan sync on business days only")).toBeInTheDocument();
    expect(screen.getByText("Generate automatic insights on business days only")).toBeInTheDocument();
    expect(screen.getByText("Scheduler timezone")).toBeInTheDocument();
    expect(screen.getByText(/Manual sync and manual triggers still run any day/i)).toBeInTheDocument();

    const policyRow = screen
      .getByText("Run automatic loan sync on business days only")
      .closest("div")?.parentElement;
    expect(policyRow).toBeTruthy();

    await userEvent.click(within(policyRow as HTMLElement).getByRole("switch"));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        "/api/admin/sync-management/los-conn-351",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            tenant_id: "tenant-cohi-351",
            sync_business_days_only: true,
          }),
        }),
      );
    });
  });
});
