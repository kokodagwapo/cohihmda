import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";
import { LeaderBoardSection } from "@/components/dashboard/LeaderBoardSection";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { useChannelStore } from "@/stores/channelStore";
import { useTenantStore } from "@/stores/tenantStore";
import { useAuth } from "@/contexts/AuthContext";

export default function LeaderboardDashboard() {
  const { dateFilter } = useDashboardFilters();
  const { selectedChannel } = useChannelStore();
  const { selectedTenantId } = useTenantStore();
  const { user } = useAuth();
  const tenantId = selectedTenantId ?? user?.tenant_id ?? null;

  return (
    <TopTieringLayout>
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <TopTieringTopBar title="Leaderboard" />
        <main className="relative flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 max-w-[1800px] mx-auto w-full">
          <LeaderBoardSection
            dateFilter={dateFilter}
            selectedTenantId={tenantId}
            selectedChannel={selectedChannel}
          />
        </main>
      </div>
    </TopTieringLayout>
  );
}
