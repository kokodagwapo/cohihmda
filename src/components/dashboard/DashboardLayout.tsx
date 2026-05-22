import React from 'react';
import { useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Navigation } from '@/components/layout/Navigation';
import { Footer } from '@/components/layout/Footer';
import { ReportsSidebar } from '@/components/dashboard/ReportsSidebar';
import { DashboardVisibility } from '@/components/dashboard/ReportsSidebar';
import { ReportData } from '@/data/reportSimulations';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { ChatShellPageGrid } from '@/components/dashboard/ChatShellPageGrid';
import { useChatShell } from '@/contexts/ChatShellContext';
import { isUnifiedChatClientEnabled } from '@/lib/unifiedChatEnvelope';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantStore } from '@/stores/tenantStore';
import { cn } from '@/lib/utils';
import { CHAT_SHELL_VIEW_TRANSITION } from '@/hooks/useChatShellAnimatedHeight';
import { isUnifiedChatShellExcluded } from '@/lib/dashboardChatShellRoutes';

interface DashboardLayoutProps {
  children: React.ReactNode;
  /** When false, never mount the unified chat shell on this layout instance. */
  enableChat?: boolean;
  isAuthenticated: boolean;
  mobileMenuOpen: boolean;
  onMobileMenuToggle: () => void;
  dashboardVisibility: DashboardVisibility;
  onVisibilityChange: (visibility: DashboardVisibility) => void;
  onReportClick: (report: ReportData) => void;
  onSectionClick?: (sectionId: string) => void;
  headerContent?: React.ReactNode;
  /** Visitor's first name for personalized sidebar greeting */
  visitorFirstName?: string | null;
}

export function DashboardLayout({
  children,
  enableChat = true,
  isAuthenticated,
  mobileMenuOpen,
  onMobileMenuToggle,
  dashboardVisibility,
  onVisibilityChange,
  onReportClick,
  onSectionClick,
  headerContent,
  visitorFirstName
}: DashboardLayoutProps) {
  const { pathname } = useLocation();
  const unifiedShell = isUnifiedChatClientEnabled();
  const { mode } = useChatShell();
  const { user } = useAuth();
  const { selectedTenantId } = useTenantStore();
  const effectiveTenantId = selectedTenantId || user?.tenant_id || undefined;
  const showChat =
    enableChat && !isUnifiedChatShellExcluded(pathname) && isAuthenticated && unifiedShell;

  const isSplitLayout = showChat && mode === 'split';

  const shellHeightClass = headerContent
    ? 'h-[calc(100dvh-7rem)]'
    : 'h-[calc(100dvh-4rem)]';

  return (
    <motion.div
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
          onMenuToggle={onMobileMenuToggle} 
          menuOpen={mobileMenuOpen}
          onSectionClick={onSectionClick}
        />
        
        {isAuthenticated && headerContent && (
          <div className="fixed top-14 sm:top-16 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700">
            <motion.div className="container mx-auto px-3 sm:px-6 md:px-8 lg:px-12 py-2">
              {headerContent}
            </motion.div>
          </div>
        )}
        
        {isAuthenticated && (
          <ReportsSidebar 
            onReportClick={onReportClick}
            visibility={dashboardVisibility}
            onVisibilityChange={onVisibilityChange}
            mobileMenuOpen={mobileMenuOpen}
            onMobileMenuToggle={onMobileMenuToggle}
            onSectionClick={onSectionClick}
            visitorFirstName={visitorFirstName}
          />
        )}
        
        <SidebarInset
          className={cn(
            'pt-16 bg-transparent w-full',
            headerContent && 'mt-12',
            isSplitLayout
              ? 'h-full min-h-0 max-h-full flex-1 !overflow-hidden'
              : 'h-full',
          )}
        >
          <motion.div
            initial={false}
            animate={{ opacity: 1 }}
            transition={CHAT_SHELL_VIEW_TRANSITION}
            className={cn(
              'min-h-0 w-full',
              isSplitLayout && cn(shellHeightClass, 'overflow-hidden'),
            )}
          >
            {showChat ? (
              <ChatShellPageGrid
                tenantId={effectiveTenantId}
                showSplitPaneFooter
                className={cn(isSplitLayout && 'h-full')}
              >
                {children}
              </ChatShellPageGrid>
            ) : (
              children
            )}
          </motion.div>
        </SidebarInset>
      </SidebarProvider>
      
      {!isSplitLayout && <Footer />}
    </motion.div>
  );
}
