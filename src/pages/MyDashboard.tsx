import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Navigation } from '@/components/layout/Navigation';
import { WorkbenchSidebar } from '@/components/workbench/WorkbenchSidebar';
import type { CanvasListItem } from '@/components/workbench/WorkbenchSidebar';
import { api } from '@/lib/api';
import { useTenantStore } from '@/stores/tenantStore';
import { useAuth } from '@/contexts/AuthContext';
import { WorkbenchCanvas } from '@/components/workbench/WorkbenchCanvas';
import { Plus, X, Sparkles, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/* ─── localStorage keys for tab persistence (tenant-scoped) ─── */
function lsTabsKey(tenantId?: string) { return `cohi-workbench-tabs${tenantId ? `-${tenantId}` : ''}`; }
function lsActiveKey(tenantId?: string) { return `cohi-workbench-active${tenantId ? `-${tenantId}` : ''}`; }

function loadPersistedTabs(tenantId?: string): { tabs: string[]; active: string | null } {
  try {
    const tabs = JSON.parse(localStorage.getItem(lsTabsKey(tenantId)) || '[]');
    const active = localStorage.getItem(lsActiveKey(tenantId)) || null;
    return { tabs: Array.isArray(tabs) ? tabs : [], active };
  } catch {
    return { tabs: [], active: null };
  }
}

function persistTabs(tabs: string[], active: string | null, tenantId?: string) {
  try {
    // Only persist saved canvas IDs (not temp "new-*" tabs)
    const saved = tabs.filter((t) => !t.startsWith('new-'));
    localStorage.setItem(lsTabsKey(tenantId), JSON.stringify(saved));
    localStorage.setItem(lsActiveKey(tenantId), active && !active.startsWith('new-') ? active : saved[saved.length - 1] ?? '');
  } catch { /* quota / private browsing */ }
}

export default function MyDashboard() {
  const { user } = useAuth();
  const { selectedTenantId } = useTenantStore();
  const effectiveTenantId = selectedTenantId || user?.tenant_id;
  const { canvasId: urlCanvasId } = useParams<{ canvasId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [canvasList, setCanvasList] = useState<CanvasListItem[]>([]);
  const [loadCanvasId, setLoadCanvasId] = useState<string | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const [canvasSearch, setCanvasSearch] = useState('');

  // Track which canvases the user has "open" as tabs (tenant-scoped)
  const persisted = useRef(loadPersistedTabs(effectiveTenantId));
  const [openTabs, setOpenTabs] = useState<string[]>(persisted.current.tabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(persisted.current.active);
  // Map temp tab IDs → readable titles for unsaved canvases
  const [tabTitles, setTabTitles] = useState<Record<string, string>>({});
  // Track which tabs have unsaved changes (dirty state from canvas autosave)
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());
  const initialised = useRef(false);

  /* ─── Backward compat: redirect ?canvas=xxx to slug-based URL ─── */
  useEffect(() => {
    const legacyCanvas = searchParams.get('canvas');
    if (legacyCanvas) {
      navigate(`/my-dashboard/${legacyCanvas}`, { replace: true });
    }
  }, [searchParams, navigate]);

  /* ─── Initialise from URL param or auto-open blank canvas ─── */
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;

    if (urlCanvasId) {
      // Open the canvas from the URL slug
      setOpenTabs((prev) => prev.includes(urlCanvasId) ? prev : [...prev, urlCanvasId]);
      setActiveTabId(urlCanvasId);
      setLoadCanvasId(urlCanvasId);
    } else if (openTabs.length === 0) {
      // Auto-open a blank canvas
      const newTabId = `new-${Date.now()}`;
      setOpenTabs([newTabId]);
      setActiveTabId(newTabId);
      setLoadCanvasId(null);
    } else if (activeTabId && openTabs.includes(activeTabId)) {
      // Restore persisted active tab
      if (!activeTabId.startsWith('new-')) {
        setLoadCanvasId(activeTabId);
        navigate(`/my-dashboard/${activeTabId}`, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── Persist tabs to localStorage when they change ─── */
  useEffect(() => {
    persistTabs(openTabs, activeTabId, effectiveTenantId);
  }, [openTabs, activeTabId, effectiveTenantId]);

  /* ─── Reload tabs when tenant changes (platform admin switching tenants) ─── */
  const prevTenantRef = useRef(effectiveTenantId);
  useEffect(() => {
    if (prevTenantRef.current === effectiveTenantId) return;
    prevTenantRef.current = effectiveTenantId;
    const { tabs, active } = loadPersistedTabs(effectiveTenantId);
    if (tabs.length > 0) {
      setOpenTabs(tabs);
      setActiveTabId(active);
      if (active && !active.startsWith('new-')) {
        setLoadCanvasId(active);
        navigate(`/my-dashboard/${active}`, { replace: true });
      } else {
        setLoadCanvasId(null);
        setCanvasKey((k) => k + 1);
        navigate('/my-dashboard', { replace: true });
      }
    } else {
      const newTabId = `new-${Date.now()}`;
      setOpenTabs([newTabId]);
      setActiveTabId(newTabId);
      setLoadCanvasId(null);
      setCanvasKey((k) => k + 1);
      navigate('/my-dashboard', { replace: true });
    }
    setDirtyTabs(new Set());
  }, [effectiveTenantId, navigate]);

  /* ─── Unsaved changes warning (beforeunload) ─── */
  useEffect(() => {
    const hasUnsaved = openTabs.some((t) => t.startsWith('new-')) || dirtyTabs.size > 0;
    if (!hasUnsaved) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers show a generic message regardless of returnValue
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [openTabs, dirtyTabs]);

  /* ─── Sync URL when active tab changes ─── */
  const updateUrl = useCallback((tabId: string | null) => {
    if (!tabId || tabId.startsWith('new-')) {
      navigate('/my-dashboard', { replace: true });
    } else {
      navigate(`/my-dashboard/${tabId}`, { replace: true });
    }
  }, [navigate]);

  /* ─── Also respond to URL changes after initial load (e.g. direct nav) ─── */
  useEffect(() => {
    if (!initialised.current) return;
    if (urlCanvasId && urlCanvasId !== activeTabId) {
      setOpenTabs((prev) => prev.includes(urlCanvasId) ? prev : [...prev, urlCanvasId]);
      setActiveTabId(urlCanvasId);
      setLoadCanvasId(urlCanvasId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlCanvasId]);

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
    updateUrl(id);
  }, [updateUrl]);

  // Create a new blank canvas tab
  const handleNewCanvas = useCallback(() => {
    const newTabId = `new-${Date.now()}`;
    setOpenTabs((prev) => [...prev, newTabId]);
    setActiveTabId(newTabId);
    setLoadCanvasId(null);
    setCanvasKey((k) => k + 1);
    updateUrl(null);
  }, [updateUrl]);

  // Close a tab (with unsaved warning)
  const handleCloseTab = useCallback((tabId: string) => {
    if (tabId.startsWith('new-') || dirtyTabs.has(tabId)) {
      const confirmed = window.confirm('This canvas has unsaved changes. Close anyway?');
      if (!confirmed) return;
      setDirtyTabs((prev) => { const next = new Set(prev); next.delete(tabId); return next; });
    }
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
        updateUrl(newActive);
      }
      return next;
    });
  }, [activeTabId, updateUrl, dirtyTabs]);

  // Switch to a tab
  const handleSwitchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    if (!tabId.startsWith('new-')) {
      setLoadCanvasId(tabId);
    } else {
      setLoadCanvasId(null);
      setCanvasKey((k) => k + 1);
    }
    updateUrl(tabId);
  }, [updateUrl]);

  // Callback from WorkbenchCanvas after a canvas is saved (new or existing)
  const handleCanvasSaved = useCallback((savedId: string, title: string) => {
    setOpenTabs((prev) => {
      // If the active tab was a temp "new-*", replace it with the real ID
      const currentActive = activeTabId;
      if (currentActive && currentActive.startsWith('new-')) {
        return prev.map((t) => t === currentActive ? savedId : t);
      }
      // Otherwise just make sure the ID is in tabs
      return prev.includes(savedId) ? prev : [...prev, savedId];
    });
    setActiveTabId(savedId);
    setTabTitles((prev) => ({ ...prev, [savedId]: title }));
    updateUrl(savedId);
    fetchCanvases();
  }, [activeTabId, updateUrl, fetchCanvases]);

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
        updateUrl(null);
      }
      fetchCanvases();
    } catch { /* silently fail */ }
  }, [effectiveTenantId, activeTabId, fetchCanvases, updateUrl]);

  // Get tab title from canvas list or override titles
  const getTabTitle = (tabId: string) => {
    if (tabId.startsWith('new-')) return 'New Canvas';
    if (tabTitles[tabId]) return tabTitles[tabId];
    const canvas = canvasList.find((c) => c.id === tabId);
    return canvas?.title || 'Untitled';
  };

  // Handle dirty-state changes from the active canvas
  const handleDirtyChange = useCallback((dirty: boolean) => {
    if (!activeTabId) return;
    setDirtyTabs((prev) => {
      const next = new Set(prev);
      if (dirty) {
        next.add(activeTabId);
      } else {
        next.delete(activeTabId);
      }
      return next;
    });
  }, [activeTabId]);

  // If no tabs are open, show an empty state
  const showEmptyState = openTabs.length === 0;

  // Determine if the current user owns the active canvas
  const activeCanvasIsOwner = useMemo(() => {
    if (!activeTabId) return true;
    if (activeTabId.startsWith('new-')) return true; // New canvases are always owned
    const canvas = canvasList.find((c) => c.id === activeTabId);
    if (!canvas) return true; // Not loaded yet — assume owner until data arrives
    return canvas.is_owner !== false;
  }, [activeTabId, canvasList]);

  return (
    <div className="h-screen overflow-hidden bg-gradient-to-br from-slate-50/90 via-white to-sky-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/80">
      <Navigation />

      {/* Main layout: sidebar + content, fills viewport below the nav */}
      <div className="flex h-[calc(100vh-3.5rem)] sm:h-[calc(100vh-4rem)] mt-14 sm:mt-16">
        {/* Sidebar – scrolls independently */}
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

        {/* Content column: sticky tab bar + scrollable canvas */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Tab bar – always visible at top */}
          <div className="flex items-center border-b border-slate-200/70 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm px-1 shrink-0 min-h-[37px] z-10">
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
                  {/* Dirty-state dot indicator */}
                  {(dirtyTabs.has(tabId) || tabId.startsWith('new-')) && (
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" title="Unsaved changes" />
                  )}
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

          {/* Canvas – fills remaining space; canvas handles its own scrolling internally */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {showEmptyState ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-6 py-20">
                <div className="relative mb-6">
                  <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-200 dark:shadow-violet-900/40">
                    <Sparkles className="h-8 w-8 text-white" />
                  </div>
                </div>
                <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">
                  Welcome to the Cohi Workbench
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-8 max-w-md leading-relaxed">
                  Build custom dashboards with drag-and-drop widgets, AI-powered insights, and real-time data from your pipeline. Start from scratch or let Cohi help you get going.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    className="gap-2 bg-violet-600 hover:bg-violet-700 text-white shadow-sm"
                    onClick={handleNewCanvas}
                  >
                    <Plus className="h-4 w-4" />
                    New Blank Canvas
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => {
                      handleNewCanvas();
                      // Open sidebar so user can browse dashboard library
                      setSidebarCollapsed(false);
                    }}
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    Browse Dashboard Library
                  </Button>
                </div>
              </div>
            ) : (
              <WorkbenchCanvas
                key={canvasKey}
                loadCanvasId={loadCanvasId}
                onLoaded={() => {
                  setLoadCanvasId(null);
                  fetchCanvases();
                }}
                onSaved={handleCanvasSaved}
                onDirtyChange={handleDirtyChange}
                tenantId={effectiveTenantId}
                isOwner={activeCanvasIsOwner}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
