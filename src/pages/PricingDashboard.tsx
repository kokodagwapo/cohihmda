// Pricing dashboard page

import { PricingDashboardView } from "@/components/views/PricingDashboardView";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";
import { useChannelStore } from "@/stores/channelStore";
import { useTenantStore } from "@/stores/tenantStore";
import { useAuth } from "@/contexts/AuthContext";

const PricingDashboard = () => {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();
  const { user } = useAuth();
  const tenantId = selectedTenantId ?? user?.tenant_id ?? null;

  return (
    <TopTieringLayout>
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <TopTieringTopBar title="Pricing Dashboard" />
        <main className="flex-1 overflow-y-auto px-2 sm:px-4 py-2 sm:py-3">
          <div className="max-w-[1800px] mx-auto">
            <PricingDashboardView
              tenantId={tenantId}
              selectedTenantId={selectedTenantId}
              selectedChannel={selectedChannel}
            />
          </div>
        </main>
      </div>
    </TopTieringLayout>
  );
};

export default PricingDashboard;
