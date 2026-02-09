import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Navigation } from '@/components/layout/Navigation';
import { WorkbenchSidebar } from '@/components/workbench/WorkbenchSidebar';
import type { CanvasListItem } from '@/components/workbench/WorkbenchSidebar';
import { api } from '@/lib/api';
import { useTenantStore } from '@/stores/tenantStore';
import { useAuth } from '@/contexts/AuthContext';
import { WorkbenchCanvas } from '@/components/workbench/WorkbenchCanvas';
import { Plus, X, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function MyDashboard() {
  const { user } = useAuth();
  const { selectedTenantId } = useTenantStore();
  const effectiveTenantId = selectedTenantId || user?.tenant_id;
  const [searchParams, setSearchParams] = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [canvasList, setCanvasList] = useState<CanvasListItem[]>([]);
  const [loadCanvasId, setLoadCanvasId] = useState<string | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const [canvasSearch, setCanvasSearch] = useState('');

  // Track which canvases the user has "open" as tabs
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Load canvas from URL parameter (e.g., /my-dashboard?canvas=abc123)
  useEffect(() => {
    const canvasParam = searchParams.get('canvas');
    if (canvasParam) {
      setLoadCanvasId(canvasParam);
      // Ensure it shows up in open tabs
      setOpenTabs((prev) => prev.includes(canvasParam) ? prev : [...prev, canvasParam]);
      setActiveTabId(canvasParam);
      searchParams.delete('canvas');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const fetchCanvases = useCallback(async () => {
    try {
      const qs = effectiveTenantId ? `?tenant_id=${encodeURIComponent(effectiveTenantId)}` : '';
      const res = await api.request<{ canvases: CanvasListItem[] }>(`/api/workbench/canvases${qs}`);
      setCanvasList(res?.canvases ?? []);
    } catch {
      setCanvasList([]);
    }
  }, [effectiveTenantId]);

  useEffect(() => {
    fetchCanvases();
  }, [fetchCanvases]);

  // Open a canvas tab (from sidebar click)
  const handleSelectCanvas = useCallback((id: string) => {
    setOpenTabs((prev) => prev.includes(id) ? prev : [...prev, id]);
    setActiveTabId(id);
    setLoadCanvasId(id);
  }, []);

  // Create a new blank canvas tab
  const handleNewCanvas = useCallback(() => {
    const newTabId = `new-${Date.now()}`;
    setOpenTabs((prev) => [...prev, newTabId]);
    setActiveTabId(newTabId);
    setLoadCanvasId(null);
    setCanvasKey((k) => k + 1);
  }, []);

  // Close a tab
  const handleCloseTab = useCallback((tabId: string) => {
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t !== tabId);
      // If closing the active tab, switch to the last remaining tab
      if (activeTabId === tabId) {
        const newActive = next.length > 0 ? next[next.length - 1] : null;
        setActiveTabId(newActive);
        if (newActive && !newActive.startsWith('new-')) {
          setLoadCanvasId(newActive);
        } else {
          setLoadCanvasId(null);
          setCanvasKey((k) => k + 1);
        }
      }
      return next;
    });
  }, [activeTabId]);

  // Switch to a tab
  const handleSwitchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    if (!tabId.startsWith('new-')) {
      setLoadCanvasId(tabId);
    } else {
      setLoadCanvasId(null);
      setCanvasKey((k) => k + 1);
    }
  }, []);

  // Delete canvas (from sidebar)
  const handleDeleteCanvas = useCallback(async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"?`)) return;
    try {
      const qs = effectiveTenantId ? `?tenant_id=${encodeURIComponent(effectiveTenantId)}` : '';
      await api.request(`/api/workbench/canvases/${id}${qs}`, { method: 'DELETE' });
      // Remove from tabs if open
      setOpenTabs((prev) => prev.filter((t) => t !== id));
      if (activeTabId === id) {
        setActiveTabId(null);
        setLoadCanvasId(null);
        setCanvasKey((k) => k + 1);
      }
      fetchCanvases();
    } catch { /* silently fail */ }
  }, [effectiveTenantId, activeTabId, fetchCanvases]);

  // Get tab title from canvas list
  const getTabTitle = (tabId: string) => {
    if (tabId.startsWith('new-')) return 'New Canvas';
    const canvas = canvasList.find((c) => c.id === tabId);
    return canvas?.title || 'Untitled';
  };

  // If no tabs are open and no URL canvas, show an empty state
  const showEmptyState = openTabs.length === 0 && !loadCanvasId;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50/90 via-white to-sky-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/80">
      <Navigation />
      <div className="flex pt-14 sm:pt-16 min-h-screen">
        <WorkbenchSidebar
          sidebarOpen={sidebarOpen}
          onSidebarOpenChange={setSidebarOpen}
          sidebarCollapsed={sidebarCollapsed}
          onSidebarCollapsedChange={setSidebarCollapsed}
          canvasList={canvasList}
          canvasSearch={canvasSearch}
          onCanvasSearchChange={setCanvasSearch}
          activeCanvasId={activeTabId}
          onSelectCanvas={handleSelectCanvas}
          onNewCanvas={handleNewCanvas}
          onDeleteCanvas={handleDeleteCanvas}
        />
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tab bar */}
          <div className="flex items-center border-b border-slate-200/70 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm px-1 shrink-0 min-h-[37px]">
            <div className="flex items-center gap-0 overflow-x-auto flex-1 min-w-0 scrollbar-none">
              {openTabs.map((tabId) => (
                <div
                  key={tabId}
                  className={cn(
                    'group flex items-center gap-1.5 px-3 py-2 text-[13px] border-b-2 cursor-pointer transition-colors shrink-0 max-w-[180px]',
                    activeTabId === tabId
                      ? 'border-violet-500 text-violet-700 dark:text-violet-300 bg-violet-50/50 dark:bg-violet-900/20 font-medium'
                      : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  )}
                  onClick={() => handleSwitchTab(tabId)}
                >
                  <span className="truncate">{getTabTitle(tabId)}</span>
                  <button
                    type="button"
                    className="ml-0.5 p-0.5 rounded hover:bg-slate-200/80 dark:hover:bg-slate-700/80 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseTab(tabId);
                    }}
                    title="Close tab"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 ml-1 shrink-0 rounded-md text-slate-500 hover:text-violet-600 dark:text-slate-400 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/30"
              onClick={handleNewCanvas}
              title="New canvas"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Canvas content */}
          <div className="flex-1 min-w-0 overflow-auto">
            {showEmptyState ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-6 py-20">
                <Palette className="h-12 w-12 text-slate-300 dark:text-slate-600 mb-4" />
                <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  No canvas open
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 max-w-sm">
                  Select a canvas from the sidebar or create a new one to get started.
                </p>
                <Button
                  className="gap-2 bg-violet-600 hover:bg-violet-700 text-white"
                  onClick={handleNewCanvas}
                >
                  <Plus className="h-4 w-4" />
                  New Canvas
                </Button>
              </div>
            ) : (
              <div className="relative flex-1 px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
                <WorkbenchCanvas
                  key={canvasKey}
                  loadCanvasId={loadCanvasId}
                  onLoaded={() => {
                    setLoadCanvasId(null);
                    fetchCanvases();
                  }}
                  tenantId={effectiveTenantId}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
