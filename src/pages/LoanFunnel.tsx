import { useState } from 'react';
import { LoanFunnelView } from '@/components/views/LoanFunnelView';
import { TopTieringLayout } from '@/components/layout/TopTieringLayout';
import { TopTieringTopBar } from '@/components/layout/TopTieringTopBar';
import { useChannelStore } from '@/stores/channelStore';
import { useTenantStore } from '@/stores/tenantStore';

const LoanFunnel = () => {
  const [view, setView] = useState<'funnel' | 'bar' | 'revenue' | 'units' | 'volume' | 'detail'>('funnel');
  const [year, setYear] = useState(new Date().getFullYear());
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  return (
    <TopTieringLayout>
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <TopTieringTopBar title="Loan Funnel" />
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-2 sm:py-3">
          <div className="max-w-[1800px] mx-auto">
            <LoanFunnelView
              view={view}
              onViewChange={setView}
              year={year}
              onYearChange={setYear}
              selectedTenantId={selectedTenantId}
              selectedChannel={selectedChannel}
            />
          </div>
        </main>
      </div>
    </TopTieringLayout>
  );
};

export default LoanFunnel;
