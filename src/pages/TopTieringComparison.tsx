import { TopTieringComparisonView } from '@/components/views/TopTieringComparisonView';
import { DASHBOARD_MAIN_CLASSNAME } from '@/components/cohi/pageContentStyles';
import { DashboardPageContent } from '@/components/layout/DashboardPageContent';
import { TopTieringLayout } from '@/components/layout/TopTieringLayout';
import { TopTieringPageFrame } from '@/components/layout/TopTieringPageFrame';
import { TopTieringTopBar } from '@/components/layout/TopTieringTopBar';
import { useChannelStore } from '@/stores/channelStore';
import { useTenantStore } from '@/stores/tenantStore';

const TopTieringComparison = () => {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  return (
    <TopTieringLayout>
      <TopTieringPageFrame topBar={<TopTieringTopBar title="TopTiering Comparison" />}>
        <main className={DASHBOARD_MAIN_CLASSNAME}>
          <DashboardPageContent>
            <TopTieringComparisonView
              selectedTenantId={selectedTenantId}
              selectedChannel={selectedChannel}
            />
          </DashboardPageContent>
        </main>
      </TopTieringPageFrame>
    </TopTieringLayout>
  );
};

export default TopTieringComparison;
