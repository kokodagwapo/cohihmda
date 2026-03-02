import { FinancialModelingSandboxView } from '@/components/views/FinancialModelingSandboxView';
import { TopTieringLayout } from '@/components/layout/TopTieringLayout';
import { TopTieringTopBar } from '@/components/layout/TopTieringTopBar';
import { useTenantStore } from '@/stores/tenantStore';

const FinancialModelingSandbox = () => {
  const { selectedTenantId } = useTenantStore();

  return (
    <TopTieringLayout>
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <TopTieringTopBar title="Financial Modeling" />
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6">
          <div className="max-w-[1800px] mx-auto">
            <FinancialModelingSandboxView selectedTenantId={selectedTenantId ?? undefined} />
          </div>
        </main>
      </div>
    </TopTieringLayout>
  );
};

export default FinancialModelingSandbox;
