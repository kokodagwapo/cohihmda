import { DASHBOARD_MAIN_CLASSNAME } from "@/components/cohi/pageContentStyles";
import { DashboardPageContent } from "@/components/layout/DashboardPageContent";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { TopTieringPageFrame } from "@/components/layout/TopTieringPageFrame";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";
import { ActiveWorkloadView } from "@/components/views/ActiveWorkloadView";
import { useChannelStore } from "@/stores/channelStore";
import { useTenantStore } from "@/stores/tenantStore";

const ActiveWorkload = () => {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  return (
    <TopTieringLayout>
      <TopTieringPageFrame topBar={<TopTieringTopBar title="Active Workload" />}>
        <main className={DASHBOARD_MAIN_CLASSNAME}>
          <div className="mx-auto max-w-[1800px]">
            <ActiveWorkloadView selectedTenantId={selectedTenantId} selectedChannel={selectedChannel} />
          </div>
        </main>
      </TopTieringPageFrame>
    </TopTieringLayout>
  );
};

export default ActiveWorkload;
