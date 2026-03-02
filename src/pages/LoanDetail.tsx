import { LoanDetailView } from '@/components/views/LoanDetailView';
import { TopTieringLayout } from '@/components/layout/TopTieringLayout';
import { TopTieringTopBar } from '@/components/layout/TopTieringTopBar';
import { useChannelStore } from '@/stores/channelStore';
import { useTenantStore } from '@/stores/tenantStore';

const LoanDetail = () => {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  return (
    <TopTieringLayout>
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <TopTieringTopBar title="Loan Detail" />
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-2 sm:py-3">
          <div className="max-w-[1800px] mx-auto">
            <LoanDetailView
              selectedTenantId={selectedTenantId}
              selectedChannel={selectedChannel}
            />
          </div>
        </main>
      </div>
    </TopTieringLayout>
  );
};

export default LoanDetail;
