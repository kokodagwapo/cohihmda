import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Share2, ArrowRight } from 'lucide-react';
import { WorkbenchTopBar } from '@/components/workbench/WorkbenchTopBar';
import { AskCohiChat } from '@/components/workbench/AskCohiChat';
import { IconBadge } from '@/components/workbench/IconBadge';
import { api } from '@/lib/api';
import { isUnifiedChatClientEnabled, postUnifiedWorkbenchHubQuery } from '@/lib/unifiedChatEnvelope';
import { WORKBENCH_HUB_SCOPE_IDS } from '@/lib/unifiedChatClient';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { useDashboardVisibility } from '@/hooks/useDashboardVisibility';
import type { ReportData } from '@/data/reportSimulations';
import { useAuth } from '@/contexts/AuthContext';

export default function SharedWithMe() {
  const { user } = useAuth();
  const { dashboardVisibility, handleVisibilityChange } = useDashboardVisibility();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [loading, setLoading] = useState(false);

  const sendPrompt = useCallback(async (prompt: string) => {
    setChatOpen(true);
    setMessages((m) => [...m, { role: 'user', content: prompt }]);
    setLoading(true);
    try {
      let answer = '';
      if (typeof window !== 'undefined' && isUnifiedChatClientEnabled()) {
        answer = await postUnifiedWorkbenchHubQuery(
          prompt,
          undefined,
          WORKBENCH_HUB_SCOPE_IDS.shared,
        );
      } else {
        const res = await api.request<{ response: string }>('/api/workbench/ai/query', {
          method: 'POST',
          body: JSON.stringify({ prompt }),
        });
        answer = res?.response ?? '';
      }
      setMessages((m) => [...m, { role: 'assistant', content: answer }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: "Sorry, I couldn't process that. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <DashboardLayout
      isAuthenticated={!!user}
      mobileMenuOpen={mobileMenuOpen}
      onMobileMenuToggle={() => setMobileMenuOpen((prev) => !prev)}
      dashboardVisibility={dashboardVisibility}
      onVisibilityChange={handleVisibilityChange}
      onReportClick={(_report: ReportData) => {}}
    >
      <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-slate-50/90 via-white to-sky-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/80 flex flex-col">
        <WorkbenchTopBar onOpenSidebar={() => setMobileMenuOpen(true)} onAsk={sendPrompt} />
        <main className="flex-1 relative w-full min-h-0 overflow-hidden">
          <div className="h-full overflow-y-auto px-4 sm:px-6 py-4 sm:py-6">
            <div className="max-w-[1600px] mx-auto">
              <div className="mb-8 sm:mb-10">
                <div className="flex items-start gap-4">
                  <IconBadge icon={Share2} variant="rose" size="xl" rounded="2xl" />
                  <div>
                    <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
                      Shared
                    </h1>
                    <p className="mt-1.5 text-[15px] text-slate-600 dark:text-slate-400 max-w-xl">
                      Dashboards, reports, and insights your teammates shared with you.
                    </p>
                    <Link
                      to="/workbench"
                      className="inline-flex items-center gap-1.5 mt-4 text-sm font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300"
                    >
                      Open My Workbench
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-dashed border-slate-200/80 dark:border-slate-700/70 bg-white/90 dark:bg-slate-900/70 p-6 sm:p-8 text-center">
                <IconBadge icon={Share2} variant="rose" size="lg" rounded="xl" className="mx-auto mb-3" />
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">No shared items yet</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  When teammates share dashboards or reports, they will appear here.
                </p>
              </div>
            </div>
          </div>
        </main>
        <AskCohiChat
          open={chatOpen}
          onOpenChange={setChatOpen}
          messages={messages}
          loading={loading}
          onSend={sendPrompt}
        />
      </div>
    </DashboardLayout>
  );
}
