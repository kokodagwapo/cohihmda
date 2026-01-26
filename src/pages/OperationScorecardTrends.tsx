import { useState } from 'react';
import { Navigation } from '@/components/layout/Navigation';
import { Footer } from '@/components/layout/Footer';
import { OperationScorecardTrendsView } from '@/components/dashboard/views/OperationScorecardTrendsView';
import { useAuth } from '@/contexts/AuthContext';
import { TenantSelector } from '@/components/dashboard/TenantSelector';
import { ChannelSelector } from '@/components/dashboard/ChannelSelector';

const OperationScorecardTrends = () => {
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // Tenant selection state for admins
  const isPlatformAdmin = user?.role === 'super_admin' || user?.role === 'platform_admin';
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(
    user?.role === 'tenant_admin' && user?.tenant_id ? user.tenant_id : null
  );
  
  // Channel filter state
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      <Navigation 
        onMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)} 
        menuOpen={mobileMenuOpen}
      />
      
      {/* Header with filters */}
      <div className="fixed top-14 sm:top-16 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700">
        <div className="container mx-auto px-3 sm:px-6 md:px-8 lg:px-12 py-2">
          <div className="flex items-center gap-4 flex-wrap">
            {isPlatformAdmin && (
              <>
                <TenantSelector
                  selectedTenantId={selectedTenantId}
                  onTenantChange={setSelectedTenantId}
                  compact={true}
                />
                <div className="h-6 w-px bg-slate-300 dark:bg-slate-600 hidden sm:block" />
              </>
            )}
            <ChannelSelector
              selectedChannel={selectedChannel}
              onChannelChange={setSelectedChannel}
              selectedTenantId={selectedTenantId}
              compact={true}
              useChannelGroups={true}
            />
          </div>
        </div>
      </div>
      
      {/* Main content */}
      <main className="pt-28 sm:pt-32 pb-8 px-3 sm:px-6 md:px-8 lg:px-12">
        <div className="container mx-auto">
          <OperationScorecardTrendsView />
        </div>
      </main>
      
      <Footer />
    </div>
  );
};

export default OperationScorecardTrends;
