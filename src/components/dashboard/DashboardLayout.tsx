import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Navigation } from '@/components/layout/Navigation';
import { Footer } from '@/components/layout/Footer';
import { ReportsSidebar } from '@/components/dashboard/ReportsSidebar';
import { DashboardVisibility } from '@/components/dashboard/ReportsSidebar';
import { ReportData } from '@/data/reportSimulations';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { UnifiedChatShell } from '@/components/cohi/UnifiedChatShell';
import { useChatShell } from '@/contexts/ChatShellContext';
import { isUnifiedChatClientEnabled } from '@/lib/unifiedChatEnvelope';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantStore } from '@/stores/tenantStore';
import { cn } from '@/lib/utils';
import { CHAT_SHELL_VIEW_TRANSITION } from '@/hooks/useChatShellAnimatedHeight';
import { useSplitPaneWheelRouting } from '@/hooks/useSplitPaneWheelRouting';

interface DashboardLayoutProps {
  children: React.ReactNode;
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
  const unifiedShell = isUnifiedChatClientEnabled();
  const { mode, isPageContentVisible } = useChatShell();
  const { user } = useAuth();
  const { selectedTenantId } = useTenantStore();
  const effectiveTenantId = selectedTenantId || user?.tenant_id || undefined;
  const location = useLocation();
  const chatPaneRef = useRef<HTMLDivElement>(null);
  const pagePaneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (location.pathname !== '/insights') return;
    const scrollRoot = pagePaneRef.current?.querySelector<HTMLElement>(
      '[data-dashboard-scroll-root]',
    );
    (scrollRoot ?? pagePaneRef.current)?.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname, location.key]);

  const splitWheel = useSplitPaneWheelRouting(
    unifiedShell && mode === 'split',
    chatPaneRef,
    pagePaneRef,
  );

  const isSplitLayout = isAuthenticated && unifiedShell && mode === 'split';

  useEffect(() => {
    if (!isSplitLayout) return;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, [isSplitLayout]);

  return (
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
          onMenuToggle={onMobileMenuToggle} 
          menuOpen={mobileMenuOpen}
          onSectionClick={onSectionClick}
        />
        
        {/* Header Content (e.g., Tenant Selector) - Fixed position below nav */}
        {isAuthenticated && headerContent && (
          <div className="fixed top-14 sm:top-16 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700">
            <div className="container mx-auto px-3 sm:px-6 md:px-8 lg:px-12 py-2">
              {headerContent}
            </div>
          </div>
        )}
        
        {/* Reports Sidebar */}
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
          <AnimatePresence initial={false}>
          {isSplitLayout ? (
            <motion.div
              key="chat-split-layout"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={CHAT_SHELL_VIEW_TRANSITION}
              className={cn(
                'min-h-0 overflow-hidden',
                headerContent
                  ? 'h-[calc(100dvh-7rem)]'
                  : 'h-[calc(100dvh-4rem)]',
              )}
            >
              <ResizablePanelGroup
                direction="horizontal"
                autoSaveId="cohi-chat-split-v1"
                className="h-full min-h-0"
              >
                <ResizablePanel
                  defaultSize={55}
                  minSize={35}
                  maxSize={75}
                  className="min-w-0"
                >
                  <div
                    ref={pagePaneRef}
                    className="min-w-0 min-h-0 h-full overflow-hidden flex flex-col"
                    onMouseEnter={splitWheel.onPagePaneEnter}
                    onMouseLeave={splitWheel.onPagePaneLeave}
                  >
                    {children}
                  </div>
                </ResizablePanel>
                <ResizableHandle
                  withHandle
                  data-testid="chat-split-resize-handle"
                  className="w-px shrink-0 bg-violet-100/80 dark:bg-indigo-900/50 transition-colors hover:bg-violet-300/80 dark:hover:bg-violet-500/40"
                />
                <ResizablePanel
                  defaultSize={45}
                  minSize={25}
                  maxSize={65}
                  className="min-w-0"
                >
                  <div
                    ref={chatPaneRef}
                    className="min-h-0 min-w-0 h-full flex flex-col overflow-hidden bg-white/95 dark:bg-slate-950/95"
                    onMouseEnter={splitWheel.onChatPaneEnter}
                    onMouseLeave={splitWheel.onChatPaneLeave}
                  >
                    <UnifiedChatShell tenantId={effectiveTenantId} />
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </motion.div>
          ) : (
            <motion.div
              key="chat-stacked-layout"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={CHAT_SHELL_VIEW_TRANSITION}
              className="min-h-0"
            >
              {isAuthenticated && unifiedShell && (
                <UnifiedChatShell tenantId={effectiveTenantId} />
              )}
              <AnimatePresence initial={false}>
                {isPageContentVisible && (
                  <motion.div
                    key="dashboard-page-content"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={CHAT_SHELL_VIEW_TRANSITION}
                    className={cn(
                      unifiedShell &&
                        "relative z-20 min-h-0 bg-white dark:bg-slate-950",
                    )}
                  >
                    {children}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
          </AnimatePresence>
        </SidebarInset>
      </SidebarProvider>
      
      {!isSplitLayout && <Footer />}
    </div>
  );
}
