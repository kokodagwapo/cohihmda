import { useMemo } from "react";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";
import { ExecutiveDashboard } from "@/components/dashboard/ExecutiveDashboard";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { useDashboardFilterAnalytics } from "@/hooks/useDashboardFilterAnalytics";
import { DASHBOARD_PAGE_KEYS } from "@/lib/dashboardPageKeys";
import { useChannelStore } from "@/stores/channelStore";
import { useTenantStore } from "@/stores/tenantStore";
import { useAuth } from "@/contexts/AuthContext";

export default function BusinessOverviewDashboard() {
  const { dateFilter, currentYear } = useDashboardFilters();
  const { selectedChannel } = useChannelStore();
  const { selectedTenantId } = useTenantStore();
  const { user } = useAuth();
  const tenantId = selectedTenantId ?? user?.tenant_id ?? null;

  const businessOverviewFilterAnalytics = useMemo(
    () => ({
      date_filter: dateFilter,
      year: currentYear,
      selected_channel: selectedChannel ?? "All",
    }),
    [dateFilter, currentYear, selectedChannel]
  );
  useDashboardFilterAnalytics(DASHBOARD_PAGE_KEYS.business_overview, businessOverviewFilterAnalytics);

  return (
    <TopTieringLayout>
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <TopTieringTopBar title="Business Overview" />
        <main className="relative flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 max-w-[1800px] mx-auto w-full">
          <ExecutiveDashboard
            dateFilter={dateFilter}
            year={currentYear}
            selectedTenantId={tenantId}
            selectedChannel={selectedChannel}
          />
        </main>
      </div>
    </TopTieringLayout>
  );
}
