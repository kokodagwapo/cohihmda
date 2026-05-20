import { FinancialModelingSandboxView } from '@/components/views/FinancialModelingSandboxView';
import { DASHBOARD_MAIN_CLASSNAME } from '@/components/cohi/pageContentStyles';
import { DashboardPageContent } from '@/components/layout/DashboardPageContent';
import { TopTieringLayout } from '@/components/layout/TopTieringLayout';
import { TopTieringPageFrame } from '@/components/layout/TopTieringPageFrame';
import { TopTieringTopBar } from '@/components/layout/TopTieringTopBar';
import { useTenantStore } from '@/stores/tenantStore';

const FinancialModelingSandbox = () => {
  const { selectedTenantId } = useTenantStore();

  return (
    <TopTieringLayout>
      <TopTieringPageFrame topBar={<TopTieringTopBar title="Financial Modeling" />}>
        <main className={DASHBOARD_MAIN_CLASSNAME}>
          <DashboardPageContent>
            <FinancialModelingSandboxView selectedTenantId={selectedTenantId ?? undefined} />
          </DashboardPageContent>
        </main>
      </TopTieringPageFrame>
    </TopTieringLayout>
  );
};

export default FinancialModelingSandbox;
