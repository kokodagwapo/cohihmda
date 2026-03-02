import { TopTieringComparisonView } from '@/components/views/TopTieringComparisonView';
import { TopTieringLayout } from '@/components/layout/TopTieringLayout';
import { TopTieringTopBar } from '@/components/layout/TopTieringTopBar';
import { useChannelStore } from '@/stores/channelStore';
import { useTenantStore } from '@/stores/tenantStore';

const TopTieringComparison = () => {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  return (
    <TopTieringLayout>
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <TopTieringTopBar title="TopTiering Comparison" />
        <main className="flex-1 overflow-y-auto px-2 sm:px-4 py-2 sm:py-3">
          <div className="max-w-[1800px] mx-auto">
            <TopTieringComparisonView
              selectedTenantId={selectedTenantId}
              selectedChannel={selectedChannel}
            />
          </div>
        </main>
      </div>
    </TopTieringLayout>
  );
};

export default TopTieringComparison;
