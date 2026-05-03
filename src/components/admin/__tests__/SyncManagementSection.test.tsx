import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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
  sync_allowed_weekdays: [1, 2, 3, 4, 5],
  sync_run_at_times: [],
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

  it("renders explicit clock-time scheduler controls and saves run times", async () => {
    renderWithProviders(<SyncManagementSection />);

    expect(await screen.findByText("Production Encompass")).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("Edit schedule (timezone, days, run times)"));

    expect(await screen.findByText("Run at specific times")).toBeInTheDocument();
    expect(screen.getByText("Timezone")).toBeInTheDocument();
    expect(screen.getByText("Allowed days")).toBeInTheDocument();
    expect(screen.queryByText(/legacy/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save schedule" }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        "/api/admin/sync-management/los-conn-351",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            tenant_id: "tenant-cohi-351",
            scheduler_timezone: "America/New_York",
            sync_allowed_weekdays: [1, 2, 3, 4, 5],
            sync_business_days_only: true,
            sync_run_at_times: [
              { hour: 8, minute: 0, runInsights: false },
              { hour: 18, minute: 0, runInsights: false },
            ],
          }),
        }),
      );
    });
  });
});
