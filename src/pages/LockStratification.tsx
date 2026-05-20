import { LockStratificationView } from "@/components/views/LockStratificationView";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { DASHBOARD_MAIN_CLASSNAME } from "@/components/cohi/pageContentStyles";
import { DashboardPageContent } from "@/components/layout/DashboardPageContent";
import { TopTieringPageFrame } from "@/components/layout/TopTieringPageFrame";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";
import { useChannelStore } from "@/stores/channelStore";
import { useTenantStore } from "@/stores/tenantStore";
import { useAuth } from "@/contexts/AuthContext";

const LockStratification = () => {
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();
  const { user } = useAuth();
  const tenantId = selectedTenantId ?? user?.tenant_id ?? null;

  return (
    <TopTieringLayout>
      <TopTieringPageFrame topBar={<TopTieringTopBar title="Lock Stratification" />}>
        <main className={DASHBOARD_MAIN_CLASSNAME}>
          <DashboardPageContent>
            <LockStratificationView
              tenantId={tenantId}
              selectedChannel={selectedChannel}
            />
          </DashboardPageContent>
        </main>
      </TopTieringPageFrame>
    </TopTieringLayout>
  );
};

export default LockStratification;
