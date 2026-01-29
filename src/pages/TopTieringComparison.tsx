import { useState } from 'react';
import { Navigation } from '@/components/layout/Navigation';
import { TopTieringComparisonView } from '@/components/dashboard/views/TopTieringComparisonView';
import { useAuth } from '@/contexts/AuthContext';
import { TopTieringSidebar } from '@/components/toptiering/TopTieringSidebar';
import { TopTieringTopBar } from '@/components/toptiering/TopTieringTopBar';
import { useChannelStore } from '@/stores/channelStore';

const TopTieringComparison = () => {
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  // Tenant selection state for admins
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(
    user?.role === 'tenant_admin' && user?.tenant_id ? user.tenant_id : null
  );
  
  // Channel filter from global store (synced with header)
  const { selectedChannel } = useChannelStore();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50/90 via-white to-sky-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/80">
      <Navigation 
        onMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)} 
        menuOpen={mobileMenuOpen}
      />
      
      {/* Background pattern */}
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
          <TopTieringTopBar title="TopTiering Comparison" onOpenSidebar={() => setSidebarOpen(true)} />
          
          {/* Main content */}
          <main className="flex-1 overflow-y-auto px-2 sm:px-4 py-2 sm:py-3">
            <div className="max-w-[1800px] mx-auto">
              <TopTieringComparisonView 
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

export default TopTieringComparison;
