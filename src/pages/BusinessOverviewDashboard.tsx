import { useMemo } from "react";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { DASHBOARD_MAIN_CLASSNAME } from "@/components/cohi/pageContentStyles";
import { DashboardPageContent } from "@/components/layout/DashboardPageContent";
import { TopTieringPageFrame } from "@/components/layout/TopTieringPageFrame";
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
      <TopTieringPageFrame topBar={<TopTieringTopBar title="Business Overview" />}>
        <main className={DASHBOARD_MAIN_CLASSNAME}>
          <ExecutiveDashboard
            dateFilter={dateFilter}
            year={currentYear}
            selectedTenantId={tenantId}
            selectedChannel={selectedChannel}
          />
        </main>
      </TopTieringPageFrame>
    </TopTieringLayout>
  );
}
