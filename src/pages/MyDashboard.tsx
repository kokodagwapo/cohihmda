import { useState, useCallback, useEffect } from 'react';
import { Navigation } from '@/components/layout/Navigation';
import { TopTieringSelectionAnalysis } from '@/components/performance/TopTieringSelectionAnalysis';
import { WorkbenchTopBar } from '@/components/workbench/WorkbenchTopBar';
import { WorkbenchSidebar } from '@/components/workbench/WorkbenchSidebar';
import { MultiCohortComparison } from '@/components/workbench/MultiCohortComparison';
import { IconBadge } from '@/components/workbench/IconBadge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useTenantStore } from '@/stores/tenantStore';
import { useAuth } from '@/contexts/AuthContext';
import { WorkbenchCanvas } from '@/components/workbench/WorkbenchCanvas';
import { LayoutGrid, BarChart3, Users, Palette, FolderOpen, Heart, Search, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type CanvasListItem = { id: string; title: string; content: any; created_at: string; updated_at: string; favorited: boolean };

export default function MyDashboard() {
  const { user } = useAuth();
  const { selectedTenantId } = useTenantStore();
  const effectiveTenantId = selectedTenantId || user?.tenant_id;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState('canvas');
  const [canvasList, setCanvasList] = useState<CanvasListItem[]>([]);
  const [loadCanvasId, setLoadCanvasId] = useState<string | null>(null);
  const [canvasSearch, setCanvasSearch] = useState('');

  const fetchCanvases = useCallback(async () => {
    try {
      const res = await api.request<{ canvases: CanvasListItem[] }>('/api/workbench/canvases');
      setCanvasList(res?.canvases ?? []);
    } catch {
      setCanvasList([]);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'canvas') fetchCanvases();
  }, [activeTab, fetchCanvases]);

  const filteredCanvases = canvasSearch.trim()
    ? canvasList.filter((c) => c.title.toLowerCase().includes(canvasSearch.trim().toLowerCase()))
    : canvasList;

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
          <WorkbenchTopBar onOpenSidebar={() => setSidebarOpen(true)} />
          <div className="flex flex-1 min-w-0">
            <div className="relative flex-1 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-auto">
              <div className={activeTab === 'canvas' ? 'w-full mx-auto' : 'mx-auto max-w-[1600px]'}>
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <div className="mb-8 sm:mb-10">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <IconBadge icon={LayoutGrid} variant="violet" size="xl" rounded="2xl" />
                        <div>
                          <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
                            My Workbench
                          </h1>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <TabsList>
                          <TabsTrigger value="canvas" className="gap-2">
                            <Palette className="h-4 w-4" />
                            Canvas
                          </TabsTrigger>
                          <TabsTrigger value="selection" className="gap-2">
                            <BarChart3 className="h-4 w-4" />
                            Current Selection
                          </TabsTrigger>
                          <TabsTrigger value="comparison" className="gap-2">
                            <Users className="h-4 w-4" />
                            Cohort Comparison
                          </TabsTrigger>
                        </TabsList>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                          onClick={() => window.dispatchEvent(new Event('cohi-chat-open'))}
                          title="Open Cohi Chat to ask questions and add insights to this canvas"
                        >
                          <MessageSquare className="h-4 w-4" />
                          Cohi Chat
                        </Button>
                      </div>
                    </div>
                  </div>
                  {activeTab === 'canvas' && canvasList.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <div className="flex items-center gap-2 min-w-0 max-w-xs sm:max-w-sm">
                        <Search className="h-4 w-4 text-slate-400 shrink-0" />
                        <Input
                          placeholder="Search canvases…"
                          value={canvasSearch}
                          onChange={(e) => setCanvasSearch(e.target.value)}
                          className="h-9 bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700"
                        />
                      </div>
                      <span className="text-sm text-slate-500 dark:text-slate-400 shrink-0">
                        <FolderOpen className="h-4 w-4 inline mr-1 align-middle" />
                        {filteredCanvases.length} canvas{filteredCanvases.length !== 1 ? 'es' : ''}
                      </span>
                    </div>
                  )}
                  {activeTab === 'canvas' && filteredCanvases.length > 0 && (
                    <div className="mb-4 flex flex-wrap gap-2">
                      {filteredCanvases.map((c) => (
                        <Button
                          key={c.id}
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => {
                            setLoadCanvasId(c.id);
                            setActiveTab('canvas');
                          }}
                        >
                          {c.favorited && <Heart className="h-4 w-4 fill-rose-500 text-rose-500" />}
                          <span className="truncate max-w-[140px]">{c.title}</span>
                        </Button>
                      ))}
                    </div>
                  )}

                  <TabsContent value="canvas" className="mt-0">
                    <WorkbenchCanvas
                      loadCanvasId={loadCanvasId}
                      onLoaded={() => {
                        setLoadCanvasId(null);
                        fetchCanvases();
                      }}
                      tenantId={effectiveTenantId}
                    />
                  </TabsContent>

                  <TabsContent value="selection" className="mt-0">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
                      {/* Main: Selection Overview */}
                      <div className="lg:col-span-8">
                        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-700/70 bg-white/95 dark:bg-slate-900/80 shadow-md shadow-slate-200/40 dark:shadow-none backdrop-blur-sm overflow-hidden">
                          <div className="px-5 pt-5 pb-4 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-3.5">
                              <IconBadge icon={BarChart3} variant="sky" size="md" rounded="xl" />
                              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Selection Overview</h2>
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
          </div>
        </div>
      </div>
    </div>
  );
}
