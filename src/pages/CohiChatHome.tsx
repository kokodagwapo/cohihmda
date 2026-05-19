/**
 * Authenticated chat landing at `/` — fullscreen unified shell, no page content.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardContainer } from "@/components/dashboard/DashboardContainer";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { CohiChatPanel } from "@/components/dashboard/CohiChatPanel";
import { useAuth } from "@/contexts/AuthContext";
import { useChatShell } from "@/contexts/ChatShellContext";
import { useDashboardVisibility } from "@/hooks/useDashboardVisibility";
import { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";
import { ReportData } from "@/data/reportSimulations";
import { useTenantStore } from "@/stores/tenantStore";

export default function CohiChatHome() {
  const { isAuthenticated, user } = useAuth();
  const { selectedTenantId } = useTenantStore();
  const tenantId = selectedTenantId || user?.tenant_id || undefined;
  const navigate = useNavigate();
  const { setMode } = useChatShell();
  const { dashboardVisibility, handleVisibilityChange } = useDashboardVisibility();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const unifiedShell = isUnifiedChatClientEnabled();

  useEffect(() => {
    setMode("full");
  }, [setMode]);

  const handleReportClick = (report: ReportData) => {
    navigate(`/insights?report=${encodeURIComponent(report.id)}`);
  };

  const handleSectionClick = (sectionId: string) => {
    navigate(`/insights#${sectionId}`);
  };

  const displayName =
    user?.first_name?.trim() ||
    user?.name?.split(/\s+/)[0] ||
    null;

  return (
    <DashboardContainer
      loading={false}
      pageError={null}
      isAuthenticated={isAuthenticated}
    >
      <DashboardLayout
        isAuthenticated={isAuthenticated}
        mobileMenuOpen={mobileMenuOpen}
        onMobileMenuToggle={() => setMobileMenuOpen((open) => !open)}
        dashboardVisibility={dashboardVisibility}
        onVisibilityChange={handleVisibilityChange}
        onReportClick={handleReportClick}
        onSectionClick={handleSectionClick}
        visitorFirstName={displayName}
      >
        {!unifiedShell ? <LegacyChatFallback tenantId={tenantId} /> : null}
      </DashboardLayout>
    </DashboardContainer>
  );
}

function LegacyChatFallback({ tenantId }: { tenantId?: string }) {
  return (
    <div className="flex flex-1 min-h-0 h-full w-full relative">
      <CohiChatPanel
        isOpen
        tenantId={tenantId}
        onClose={() => {}}
        className="flex-1 min-h-0 h-full"
      />
    </div>
  );
}
