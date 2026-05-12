import React, { useRef, useMemo, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Link, ShieldCheck } from 'lucide-react';
import { CohiBuilderEmbedded } from '@/cohibuilder/CohiBuilderEmbedded';
import { CohiBuilderPortfolioProvider } from '@/cohibuilder/contexts/CohiBuilderPortfolioContext';
import '@/cohibuilder/cohibuilder.css';
import { TopTieringLayout } from '@/components/layout/TopTieringLayout';
import { useDashboardFilterAnalytics } from '@/hooks/useDashboardFilterAnalytics';
import { DASHBOARD_PAGE_KEYS } from '@/lib/dashboardPageKeys';
import { cn } from '@/lib/utils';
import { FunnelPeriodControl } from '@/cohibuilder/components/FunnelPeriodControl';

type CaptureAnalysisLocationState = { captureAnalysisTab?: 'builder' };

type CaptureSectionTab = 'builder' | 'integrations' | 'trid';

const CaptureAnalysis = () => {
  const pageRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  /**
   * - Capture Analysis: default builder (dashboard); keeps hideNav only, clears view/ids.
   * - Integrations: hideNav + view=integrations (drops stale builder params).
   * - Trid Compliance: /capture-analysis?view=respa&hideNav=1
   */
  const buildCapturePath = useCallback((tab: CaptureSectionTab) => {
    const q = new URLSearchParams(location.search);
    if (tab === 'integrations') {
      const next = new URLSearchParams();
      const hideNav = q.get('hideNav');
      if (hideNav) next.set('hideNav', hideNav);
      next.set('view', 'integrations');
      return `/capture-analysis?${next.toString()}`;
    }
    if (tab === 'trid') {
      return '/capture-analysis?view=respa&hideNav=1';
    }
    const next = new URLSearchParams();
    const hideNav = q.get('hideNav');
    if (hideNav) next.set('hideNav', hideNav);
    const qs = next.toString();
    return `/capture-analysis${qs ? `?${qs}` : ''}`;
  }, [location.search]);

  const viewParam = new URLSearchParams(location.search).get('view');
  const activeTab: CaptureSectionTab =
    viewParam === 'integrations'
      ? 'integrations'
      : viewParam === 'respa' || viewParam === 'respa-detail'
        ? 'trid'
        : 'builder';

  const captureAnalysisFilterAnalytics = useMemo(
    () => ({ active_section: activeTab }),
    [activeTab],
  );
  useDashboardFilterAnalytics(DASHBOARD_PAGE_KEYS.capture_analysis, captureAnalysisFilterAnalytics);

  useEffect(() => {
    const st = location.state as CaptureAnalysisLocationState | null;
    if (st?.captureAnalysisTab === 'builder') {
      navigate(buildCapturePath('builder'), { replace: true, state: {} });
    }
  }, [location.state, navigate, buildCapturePath]);

  const captureHeaderExtras = useMemo(
    () => (
      <div className="flex w-max max-w-full min-w-0 flex-wrap items-center justify-end gap-2">
        <div
          role="tablist"
          aria-label="Capture Analysis sections"
          className="inline-flex w-max max-w-full shrink-0 items-center gap-0.5 rounded-md border border-white/50 bg-slate-200/40 p-0.5 dark:border-white/10 dark:bg-slate-800/50"
        >
          {(
            [
              { id: 'builder' as const, label: 'Capture Analysis', Icon: LayoutDashboard },
              { id: 'trid' as const, label: 'Trid Compliance', Icon: ShieldCheck },
              { id: 'integrations' as const, label: 'Integrations', Icon: Link },
            ] as const
          ).map(({ id, label, Icon }) => {
            const selected = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => navigate(buildCapturePath(id))}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded px-2 py-1.5 text-xs font-medium transition-colors sm:gap-1.5 sm:px-2.5 sm:text-sm',
                  selected
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
                <span className="whitespace-nowrap">{label}</span>
              </button>
            );
          })}
        </div>
        {activeTab === 'builder' || activeTab === 'trid' ? <FunnelPeriodControl /> : null}
      </div>
    ),
    [activeTab, buildCapturePath, navigate],
  );

  return (
    <TopTieringLayout>
      <div ref={pageRef} className="flex flex-col min-h-[calc(100vh-4rem)] bg-slate-50/50 dark:bg-slate-950">
        <main className="flex-1 overflow-y-auto pb-8 px-4 sm:px-6 lg:px-8 pt-3 sm:pt-4">
          <CohiBuilderPortfolioProvider>
            <div className="max-w-[min(100%,1800px)] mx-auto w-full">
              {/* Single embedded shell: Layout header (search + tabs + period). Keep below global nav — no negative margin. */}
              <div className="mt-2 sm:mt-3">
                <CohiBuilderEmbedded headerAfterSearch={captureHeaderExtras} />
              </div>
            </div>
          </CohiBuilderPortfolioProvider>
        </main>
      </div>
    </TopTieringLayout>
  );
};

export default CaptureAnalysis;
