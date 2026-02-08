import { useState, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Navigation } from '@/components/layout/Navigation';
import { TopTieringSidebar } from '@/components/toptiering/TopTieringSidebar';
import { TopTieringTopBar } from '@/components/toptiering/TopTieringTopBar';

const pathToTitle: Record<string, string> = {
  '/loan-funnel': 'Loan Funnel',
  '/credit-risk-management': 'Credit Risk Management',
  '/company-scorecard': 'Company Scorecard',
  '/performance/toptiering-comparison': 'TopTiering Comparison',
  '/performance/financial-modeling-sandbox': 'Financial Modeling',
  '/sales-scorecard': 'Sales Scorecard',
  '/sales-trends': 'Sales Trends',
  '/performance/operation-scorecard': 'Operations Scorecard',
  '/performance/operation-scorecard-trends': 'Operations Trends',
};

function getTitle(pathname: string): string {
  return pathToTitle[pathname] ?? 'Top Tiering';
}

export function TopTieringLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const location = useLocation();
  const exportRef = useRef<HTMLDivElement>(null);
  const disableTopBarExport = location.pathname === "/company-scorecard";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50/90 via-white to-sky-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/80">
      <Navigation />

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
          <TopTieringTopBar
            title={getTitle(location.pathname)}
            onOpenSidebar={() => setSidebarOpen(true)}
            exportTargetRef={disableTopBarExport ? undefined : exportRef}
          />
          <main className="flex-1 relative w-full min-h-0 overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                ref={exportRef}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="h-full overflow-y-auto px-4 sm:px-6 py-4 sm:py-6"
              >
                <div className="max-w-[1800px] mx-auto">
                  <Outlet />
                </div>
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </div>
  );
}
