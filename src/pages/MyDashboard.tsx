import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Navigation } from '@/components/layout/Navigation';
import { TopTieringSelectionAnalysis } from '@/components/performance/TopTieringSelectionAnalysis';
import { WorkbenchTopBar } from '@/components/workbench/WorkbenchTopBar';
import { WorkbenchSidebar } from '@/components/workbench/WorkbenchSidebar';
import { AskCohiChat } from '@/components/workbench/AskCohiChat';
import { MultiCohortComparison } from '@/components/workbench/MultiCohortComparison';
import { IconBadge } from '@/components/workbench/IconBadge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { LayoutGrid, ArrowRight, BarChart3, Users } from 'lucide-react';

export default function MyDashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [loading, setLoading] = useState(false);

  const sendPrompt = useCallback(async (prompt: string) => {
    setChatOpen(true);
    setMessages((m) => [...m, { role: 'user', content: prompt }]);
    setLoading(true);
    try {
      const res = await api.request<{ response: string }>('/api/workbench/ai/query', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      });
      setMessages((m) => [...m, { role: 'assistant', content: res?.response ?? '' }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: "Sorry, I couldn't process that. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50/90 via-white to-sky-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/80">
      <Navigation />
      <div className="flex pt-14 sm:pt-16 min-h-screen">
        <WorkbenchSidebar
          sidebarOpen={sidebarOpen}
          onSidebarOpenChange={setSidebarOpen}
          sidebarCollapsed={sidebarCollapsed}
          onSidebarCollapsedChange={setSidebarCollapsed}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <WorkbenchTopBar onOpenSidebar={() => setSidebarOpen(true)} onAsk={sendPrompt} />
          <div className="flex flex-1 min-w-0">
            <div className="relative flex-1 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-auto">
              <div className="mx-auto max-w-[1600px]">
                {/* Hero */}
                <div className="mb-8 sm:mb-10">
                  <div className="flex items-start gap-4">
                    <IconBadge icon={LayoutGrid} variant="violet" size="xl" rounded="2xl" />
                    <div>
                      <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
                        My Workbench
                      </h1>
                      <p className="mt-1.5 text-[15px] text-slate-600 dark:text-slate-400 max-w-xl">
                        Review selections and compare performance across saved or ad-hoc cohorts.
                      </p>
                      <Link
                        to="/performance/toptiering-comparison"
                        className="inline-flex items-center gap-1.5 mt-4 text-sm font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300"
                      >
                        Open TopTiering Comparison
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </div>

                <Tabs defaultValue="selection" className="w-full">
                  <TabsList className="mb-6">
                    <TabsTrigger value="selection" className="gap-2">
                      <BarChart3 className="h-4 w-4" />
                      Current Selection
                    </TabsTrigger>
                    <TabsTrigger value="comparison" className="gap-2">
                      <Users className="h-4 w-4" />
                      Cohort Comparison
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="selection" className="mt-0">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
                      {/* Main: Selection Overview */}
                      <div className="lg:col-span-8">
                        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-700/70 bg-white/95 dark:bg-slate-900/80 shadow-md shadow-slate-200/40 dark:shadow-none backdrop-blur-sm overflow-hidden">
                          <div className="px-5 pt-5 pb-4 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-3.5">
                              <IconBadge icon={BarChart3} variant="sky" size="md" rounded="xl" />
                              <div>
                                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Selection Overview</h2>
                                <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
                                  Mirrors your selections from the TopTiering Comparison page.
                                </p>
                              </div>
                            </div>
                          </div>
                          <div className="p-5">
                            <TopTieringSelectionAnalysis variant="inline" />
                          </div>
                        </div>
                      </div>

                      {/* Sidebar: Compact summary */}
                      <div className="lg:col-span-4">
                        <div className="sticky top-24">
                          <TopTieringSelectionAnalysis variant="compact" hideWhenEmpty />
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="comparison" className="mt-0">
                    <MultiCohortComparison />
                  </TabsContent>
                </Tabs>
              </div>
            </div>
            <AskCohiChat
              open={chatOpen}
              onOpenChange={setChatOpen}
              messages={messages}
              loading={loading}
              onSend={sendPrompt}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
