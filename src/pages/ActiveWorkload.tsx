import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";
import { ActiveWorkloadView } from "@/components/views/ActiveWorkloadView";
import { useChannelStore } from "@/stores/channelStore";
import { useTenantStore } from "@/stores/tenantStore";

const ActiveWorkload = () => {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  return (
    <TopTieringLayout>
      <div className="flex min-h-[calc(100vh-4rem)] flex-col">
        <TopTieringTopBar title="Active Workload" />
        <main className="flex-1 overflow-y-auto px-4 py-2 sm:px-6 sm:py-3">
          <div className="mx-auto max-w-[1800px]">
            <ActiveWorkloadView selectedTenantId={selectedTenantId} selectedChannel={selectedChannel} />
          </div>
        </main>
      </div>
    </TopTieringLayout>
  );
};

export default ActiveWorkload;
