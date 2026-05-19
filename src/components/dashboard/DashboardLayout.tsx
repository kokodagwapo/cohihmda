import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Navigation } from '@/components/layout/Navigation';
import { Footer } from '@/components/layout/Footer';
import { ReportsSidebar } from '@/components/dashboard/ReportsSidebar';
import { DashboardVisibility } from '@/components/dashboard/ReportsSidebar';
import { ReportData } from '@/data/reportSimulations';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { UnifiedChatShell } from '@/components/cohi/UnifiedChatShell';
import { useChatShell } from '@/contexts/ChatShellContext';
import { isUnifiedChatClientEnabled } from '@/lib/unifiedChatEnvelope';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantStore } from '@/stores/tenantStore';
import { cn } from '@/lib/utils';
import { CHAT_SHELL_VIEW_TRANSITION } from '@/hooks/useChatShellAnimatedHeight';
import { useSplitPaneWheelRouting } from '@/hooks/useSplitPaneWheelRouting';

const SPLIT_PAGE_PERCENT_KEY = 'cohi-chat-split-page-percent-v1';
const DEFAULT_SPLIT_PAGE_PERCENT = 55;

function readSplitPagePercent(): number {
  if (typeof window === 'undefined') return DEFAULT_SPLIT_PAGE_PERCENT;
  try {
    const raw = window.localStorage.getItem(SPLIT_PAGE_PERCENT_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 35 && n <= 75) return n;
  } catch {
    /* ignore */
  }
  return DEFAULT_SPLIT_PAGE_PERCENT;
}

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
  const layoutRootRef = useRef<HTMLDivElement>(null);
  const [splitPagePercent, setSplitPagePercent] = useState(readSplitPagePercent);
  const dragStateRef = useRef<{ startX: number; startPercent: number } | null>(
    null,
  );

  useEffect(() => {
    if (location.pathname !== '/insights') return;
    const scrollRoot = pagePaneRef.current?.querySelector<HTMLElement>(
      '[data-dashboard-scroll-root]',
    );
    (scrollRoot ?? pagePaneRef.current)?.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname, location.key]);

  const isSplitLayout = isAuthenticated && unifiedShell && mode === 'split';

  const splitWheel = useSplitPaneWheelRouting(
    isSplitLayout,
    chatPaneRef,
    pagePaneRef,
  );

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

  const onSplitHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStateRef.current = { startX: e.clientX, startPercent: splitPagePercent };
      const onMove = (ev: MouseEvent) => {
        const root = layoutRootRef.current;
        const drag = dragStateRef.current;
        if (!root || !drag) return;
        const width = root.getBoundingClientRect().width;
        if (width <= 0) return;
        const deltaPercent = ((ev.clientX - drag.startX) / width) * 100;
        const next = Math.min(75, Math.max(35, drag.startPercent + deltaPercent));
        setSplitPagePercent(next);
      };
      const onUp = () => {
        dragStateRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        setSplitPagePercent((current) => {
          try {
            window.localStorage.setItem(SPLIT_PAGE_PERCENT_KEY, String(current));
          } catch {
            /* ignore */
          }
          return current;
        });
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [splitPagePercent],
  );

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
            {/*
              Stable three-slot grid: page | handle | chat always stay mounted.
              Only CSS grid template changes between stacked and split so draft
              canvases are not destroyed when chat view mode changes.
            */}
            <motion.div
              ref={layoutRootRef}
              className={cn(
                'h-full min-h-0 w-full grid',
                isSplitLayout
                  ? 'grid-rows-1'
                  : 'grid-cols-1 grid-rows-[auto_minmax(0,1fr)]',
              )}
              style={
                isSplitLayout
                  ? {
                      gridTemplateColumns: `minmax(0, ${splitPagePercent}fr) 6px minmax(260px, ${100 - splitPagePercent}fr)`,
                    }
                  : undefined
              }
            >
              <motion.div
                ref={pagePaneRef}
                className={cn(
                  'min-h-0 min-w-0 overflow-hidden flex flex-col',
                  !isSplitLayout &&
                    unifiedShell &&
                    'relative z-20 bg-white dark:bg-slate-950',
                  !isSplitLayout && !isPageContentVisible && 'hidden',
                )}
                style={
                  isSplitLayout
                    ? { gridColumn: 1, gridRow: 1 }
                    : { gridColumn: 1, gridRow: 2 }
                }
                onMouseEnter={isSplitLayout ? splitWheel.onPagePaneEnter : undefined}
                onMouseLeave={isSplitLayout ? splitWheel.onPagePaneLeave : undefined}
              >
                {children}
              </motion.div>

              <div
                role="separator"
                aria-orientation="vertical"
                data-testid="chat-split-resize-handle"
                className={cn(
                  'touch-none select-none bg-violet-100/80 dark:bg-indigo-900/50 transition-colors hover:bg-violet-300/80 dark:hover:bg-violet-500/40',
                  isSplitLayout
                    ? 'cursor-col-resize'
                    : 'hidden',
                )}
                style={
                  isSplitLayout
                    ? { gridColumn: 2, gridRow: 1 }
                    : undefined
                }
                onMouseDown={onSplitHandleMouseDown}
              />

              <motion.div
                ref={chatPaneRef}
                className={cn(
                  'min-h-0 min-w-0 overflow-hidden flex flex-col',
                  isSplitLayout &&
                    'bg-white/95 dark:bg-slate-950/95',
                )}
                style={
                  isSplitLayout
                    ? { gridColumn: 3, gridRow: 1 }
                    : { gridColumn: 1, gridRow: 1 }
                }
                onMouseEnter={isSplitLayout ? splitWheel.onChatPaneEnter : undefined}
                onMouseLeave={isSplitLayout ? splitWheel.onChatPaneLeave : undefined}
              >
                {isAuthenticated && unifiedShell && (
                  <UnifiedChatShell tenantId={effectiveTenantId} />
                )}
              </motion.div>
            </motion.div>
          </motion.div>
        </SidebarInset>
      </SidebarProvider>
      
      {!isSplitLayout && <Footer />}
    </motion.div>
  );
}
