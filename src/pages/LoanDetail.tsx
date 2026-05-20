import { LoanDetailView } from '@/components/views/LoanDetailView';
import { LOAN_DETAIL_STANDALONE_COLUMNS_STORE_ID } from '@/stores/loanDetailColumnsStore';
import { TopTieringLayout } from '@/components/layout/TopTieringLayout';
import { DASHBOARD_MAIN_CLASSNAME } from "@/components/cohi/pageContentStyles";
import { DashboardPageContent } from "@/components/layout/DashboardPageContent";
import { TopTieringPageFrame } from '@/components/layout/TopTieringPageFrame';
import { TopTieringTopBar } from '@/components/layout/TopTieringTopBar';
import { useChannelStore } from '@/stores/channelStore';
import { useTenantStore } from '@/stores/tenantStore';

const LoanDetail = () => {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  return (
    <TopTieringLayout>
      <TopTieringPageFrame topBar={<TopTieringTopBar title="Loan Detail" />}>
        <main className={DASHBOARD_MAIN_CLASSNAME}>
          <DashboardPageContent>
            <LoanDetailView
              selectedTenantId={selectedTenantId}
              selectedChannel={selectedChannel}
              columnsStoreId={LOAN_DETAIL_STANDALONE_COLUMNS_STORE_ID}
            />
          </DashboardPageContent>
        </main>
      </TopTieringPageFrame>
    </TopTieringLayout>
  );
};

export default LoanDetail;
