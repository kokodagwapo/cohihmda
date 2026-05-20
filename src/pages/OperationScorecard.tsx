import { DASHBOARD_MAIN_CLASSNAME } from "@/components/cohi/pageContentStyles";
import { DashboardPageContent } from "@/components/layout/DashboardPageContent";
import { OperationsScorecardView } from '@/components/views/OperationsScorecardView';
import { TopTieringLayout } from '@/components/layout/TopTieringLayout';
import { TopTieringPageFrame } from '@/components/layout/TopTieringPageFrame';
import { TopTieringTopBar } from '@/components/layout/TopTieringTopBar';
import { useChannelStore } from '@/stores/channelStore';
import { useTenantStore } from '@/stores/tenantStore';

const OperationScorecard = () => {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  return (
    <TopTieringLayout>
      <TopTieringPageFrame topBar={<TopTieringTopBar title="Operations Scorecard" />}>
        <main className={DASHBOARD_MAIN_CLASSNAME}>
          <DashboardPageContent>
            <OperationsScorecardView
              selectedTenantId={selectedTenantId}
              selectedChannel={selectedChannel}
            />
          </DashboardPageContent>
        </main>
      </TopTieringPageFrame>
    </TopTieringLayout>
  );
};

export default OperationScorecard;
