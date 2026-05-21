import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useDashboardFilterAnalytics } from "@/hooks/useDashboardFilterAnalytics";
import { DASHBOARD_PAGE_KEYS } from "@/lib/dashboardPageKeys";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
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
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <TopTieringTopBar title="Coheus Fallout Report" />
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-2 sm:py-3">
          <div className="max-w-[1800px] mx-auto">
            <ClosingFalloutForecast
              dateFilter="mtd"
              selectedTenantId={selectedTenantId}
              selectedChannel={selectedChannel}
              openLoanId={openLoanId}
              onOpenLoanIdHandled={handleLoanIdHandled}
            />
          </div>
        </main>
      </div>
    </TopTieringLayout>
  );
};

export default FalloutForecast;
