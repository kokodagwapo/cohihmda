import { OperationScorecardTrendsView } from '@/components/views/OperationScorecardTrendsView';
import { TopTieringLayout } from '@/components/layout/TopTieringLayout';
import { DASHBOARD_MAIN_CLASSNAME } from "@/components/cohi/pageContentStyles";
import { DashboardPageContent } from "@/components/layout/DashboardPageContent";
import { TopTieringPageFrame } from '@/components/layout/TopTieringPageFrame';
import { TopTieringTopBar } from '@/components/layout/TopTieringTopBar';
import { useChannelStore } from '@/stores/channelStore';
import { useTenantStore } from '@/stores/tenantStore';

const OperationScorecardTrends = () => {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  return (
    <TopTieringLayout>
      <TopTieringPageFrame topBar={<TopTieringTopBar title="Operations Trends" />}>
        <main className={DASHBOARD_MAIN_CLASSNAME}>
          <DashboardPageContent>
            <OperationScorecardTrendsView
              selectedTenantId={selectedTenantId}
              selectedChannel={selectedChannel}
            />
          </DashboardPageContent>
        </main>
      </TopTieringPageFrame>
    </TopTieringLayout>
  );
};

export default OperationScorecardTrends;
