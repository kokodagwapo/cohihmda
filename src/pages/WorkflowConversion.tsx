import { DASHBOARD_MAIN_CLASSNAME } from "@/components/cohi/pageContentStyles";
import { DashboardPageContent } from "@/components/layout/DashboardPageContent";
import { WorkflowConversionView } from '@/components/views/WorkflowConversionView';
import { TopTieringLayout } from '@/components/layout/TopTieringLayout';
import { TopTieringPageFrame } from '@/components/layout/TopTieringPageFrame';
import { TopTieringTopBar } from '@/components/layout/TopTieringTopBar';
import { useChannelStore } from '@/stores/channelStore';
import { useTenantStore } from '@/stores/tenantStore';

const WorkflowConversion = () => {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  return (
    <TopTieringLayout>
      <TopTieringPageFrame topBar={<TopTieringTopBar title="Workflow Conversion" />}>
        <main className={DASHBOARD_MAIN_CLASSNAME}>
          <DashboardPageContent>
            <WorkflowConversionView
              selectedTenantId={selectedTenantId}
              selectedChannel={selectedChannel}
            />
          </DashboardPageContent>
        </main>
      </TopTieringPageFrame>
    </TopTieringLayout>
  );
};

export default WorkflowConversion;
