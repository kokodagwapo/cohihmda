import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useDashboardFilterAnalytics } from "@/hooks/useDashboardFilterAnalytics";
import { DASHBOARD_PAGE_KEYS } from "@/lib/dashboardPageKeys";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { DASHBOARD_MAIN_CLASSNAME } from "@/components/cohi/pageContentStyles";
import { DashboardPageContent } from "@/components/layout/DashboardPageContent";
import { TopTieringPageFrame } from "@/components/layout/TopTieringPageFrame";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";
import { ClosingFalloutForecast } from "@/components/dashboard/ClosingFalloutForecast";
import { useChannelStore } from "@/stores/channelStore";
import { useTenantStore } from "@/stores/tenantStore";

const FalloutForecast = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();
  const openLoanId = searchParams.get("loan") ?? undefined;

  const falloutFilterAnalytics = useMemo(
    () => ({
      date_filter: "mtd" as const,
      open_loan_id: openLoanId ?? null,
      selected_channel: selectedChannel ?? "All",
    }),
    [openLoanId, selectedChannel]
  );
  useDashboardFilterAnalytics(DASHBOARD_PAGE_KEYS.fallout_forecast, falloutFilterAnalytics);

  const handleLoanIdHandled = () => {
    if (!openLoanId) return;
    const next = new URLSearchParams(searchParams);
    next.delete("loan");
    setSearchParams(next, { replace: true });
  };

  return (
    <TopTieringLayout>
      <TopTieringPageFrame topBar={<TopTieringTopBar title="Coheus Fallout Report" />}>
        <main className={DASHBOARD_MAIN_CLASSNAME}>
          <DashboardPageContent>
            <ClosingFalloutForecast
              dateFilter="mtd"
              selectedTenantId={selectedTenantId}
              selectedChannel={selectedChannel}
              openLoanId={openLoanId}
              onOpenLoanIdHandled={handleLoanIdHandled}
            />
          </DashboardPageContent>
        </main>
      </TopTieringPageFrame>
    </TopTieringLayout>
  );
};

export default FalloutForecast;
