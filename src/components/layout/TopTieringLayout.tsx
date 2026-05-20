import React, { createContext, useContext, useMemo, useState } from 'react';
import { Navigation } from '@/components/layout/Navigation';
import { Footer } from '@/components/layout/Footer';
import { ReportsSidebar } from '@/components/dashboard/ReportsSidebar';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import type { ReportData } from '@/data/reportSimulations';
import { useAuth } from '@/contexts/AuthContext';
import { useChatShell } from '@/contexts/ChatShellContext';
import { isUnifiedChatClientEnabled } from '@/lib/unifiedChatEnvelope';
import { cn } from '@/lib/utils';

const TopTieringLayoutContext = createContext<{ openMobileMenu: () => void } | null>(null);
export const useTopTieringLayout = () => useContext(TopTieringLayoutContext);

interface TopTieringLayoutProps {
  children: React.ReactNode;
  /** Visitor's first name for sidebar greeting (defaults to user.full_name or email prefix) */
  visitorFirstName?: string | null;
}

export function TopTieringLayout({ children, visitorFirstName: propVisitorFirstName }: TopTieringLayoutProps) {
  const { user } = useAuth();
  const visitorFirstName = useMemo(() => {
    if (propVisitorFirstName != null) return propVisitorFirstName;
    if (user?.full_name) return String(user.full_name).trim().split(/\s+/)[0] || null;
    if (user?.email) {
      const prefix = String(user.email).split('@')[0] ?? '';
      return prefix ? prefix.charAt(0).toUpperCase() + prefix.slice(1) : null;
    }
    return null;
  }, [propVisitorFirstName, user?.full_name, user?.email]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const openMobileMenu = () => setMobileMenuOpen(true);
  const unifiedShell = isUnifiedChatClientEnabled();
  const { mode } = useChatShell();
  const isSplitLayout = !!user && unifiedShell && mode === 'split';

  return (
    <TopTieringLayoutContext.Provider value={{ openMobileMenu }}>
      <div
        className={cn(
          'bg-white dark:bg-slate-950',
          isSplitLayout ? 'h-dvh max-h-dvh overflow-hidden' : 'min-h-screen',
        )}
      >
        <SidebarProvider
          defaultOpen={true}
          className={cn(isSplitLayout && 'h-full max-h-full overflow-hidden')}
        >
          <Navigation
            onMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)}
            menuOpen={mobileMenuOpen}
          />

          <ReportsSidebar
            onReportClick={(_report: ReportData) => {}}
            mobileMenuOpen={mobileMenuOpen}
            onMobileMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)}
            visitorFirstName={visitorFirstName}
          />

          <SidebarInset
            className={cn(
              'pt-16 bg-transparent w-full',
              isSplitLayout ? 'h-full min-h-0 max-h-full flex-1 !overflow-hidden' : 'h-full',
            )}
          >
            {children}
          </SidebarInset>
        </SidebarProvider>

        {!isSplitLayout && <Footer />}
      </div>
    </TopTieringLayoutContext.Provider>
  );
}
