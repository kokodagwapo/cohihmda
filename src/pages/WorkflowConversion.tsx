import { useState } from "react";
import { Navigation } from "@/components/layout/Navigation";
import { WorkflowConversionView } from "@/components/views/WorkflowConversionView";
import { useChannelStore } from "@/stores/channelStore";
import { useTenantStore } from "@/stores/tenantStore";
import { TopTieringSidebar } from "@/components/layout/TopTieringSidebar";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";

const WorkflowConversion = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { selectedTenantId } = useTenantStore();
  const { selectedChannel } = useChannelStore();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50/90 via-white to-sky-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/80">
      <Navigation onMenuToggle={() => {}} menuOpen={false} />

      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(59,130,246,0.03),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(168,85,247,0.02),transparent_50%)] pointer-events-none"
        aria-hidden
      />

      <div className="flex pt-14 sm:pt-16 min-h-screen relative">
        <TopTieringSidebar
          sidebarOpen={sidebarOpen}
          onSidebarOpenChange={setSidebarOpen}
          sidebarCollapsed={sidebarCollapsed}
          onSidebarCollapsedChange={setSidebarCollapsed}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <TopTieringTopBar
            title="Workflow Conversion"
            onOpenSidebar={() => setSidebarOpen(true)}
          />

          <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-2 sm:py-3">
            <div className="max-w-[1800px] mx-auto">
              <WorkflowConversionView
                selectedTenantId={selectedTenantId}
                selectedChannel={selectedChannel}
              />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default WorkflowConversion;
