import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { DASHBOARD_MAIN_CLASSNAME } from "@/components/cohi/pageContentStyles";
import { DashboardPageContent } from "@/components/layout/DashboardPageContent";
import { TopTieringPageFrame } from "@/components/layout/TopTieringPageFrame";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";
import { EstimatedClosingsRiskView } from "@/components/views/EstimatedClosingsRiskView";
import { useChannelStore } from "@/stores/channelStore";
import { useTenantStore } from "@/stores/tenantStore";

const EstimatedClosingsRisk = () => {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  return (
    <TopTieringLayout>
      <TopTieringPageFrame topBar={<TopTieringTopBar title="Estimated Closings and Risk Analysis" />}>
        <main className={DASHBOARD_MAIN_CLASSNAME}>
          <div className="mx-auto max-w-[1800px]">
            <EstimatedClosingsRiskView
              selectedTenantId={selectedTenantId}
              selectedChannel={selectedChannel}
            />
          </div>
        </main>
      </TopTieringPageFrame>
    </TopTieringLayout>
  );
};

export default EstimatedClosingsRisk;

