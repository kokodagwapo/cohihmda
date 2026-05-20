import { DASHBOARD_MAIN_CLASSNAME } from "@/components/cohi/pageContentStyles";
import { DashboardPageContent } from "@/components/layout/DashboardPageContent";
import { useMemo } from "react";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { TopTieringPageFrame } from "@/components/layout/TopTieringPageFrame";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";
import { LeaderBoardSection } from "@/components/dashboard/LeaderBoardSection";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { useDashboardFilterAnalytics } from "@/hooks/useDashboardFilterAnalytics";
import { DASHBOARD_PAGE_KEYS } from "@/lib/dashboardPageKeys";
import { useChannelStore } from "@/stores/channelStore";
import { useTenantStore } from "@/stores/tenantStore";
import { useAuth } from "@/contexts/AuthContext";

export default function LeaderboardDashboard() {
  const { dateFilter } = useDashboardFilters();
  const { selectedChannel } = useChannelStore();
  const { selectedTenantId } = useTenantStore();
  const { user } = useAuth();
  const tenantId = selectedTenantId ?? user?.tenant_id ?? null;

  const leaderboardFilterAnalytics = useMemo(
    () => ({
      date_filter: dateFilter,
      selected_channel: selectedChannel ?? "All",
    }),
    [dateFilter, selectedChannel]
  );
  useDashboardFilterAnalytics(DASHBOARD_PAGE_KEYS.leaderboard, leaderboardFilterAnalytics);

  return (
    <TopTieringLayout>
      <TopTieringPageFrame topBar={<TopTieringTopBar title="Leaderboard" />}>
        <main className={DASHBOARD_MAIN_CLASSNAME}>
          <DashboardPageContent>
            <LeaderBoardSection
            dateFilter={dateFilter}
            selectedTenantId={tenantId}
            selectedChannel={selectedChannel}
          />
          </DashboardPageContent>
        </main>
      </TopTieringPageFrame>
    </TopTieringLayout>
  );
}
