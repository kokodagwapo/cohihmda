import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useTenantStore } from '@/stores/tenantStore';
import { useAuth } from '@/contexts/AuthContext';
import { WorkbenchCanvas } from '@/components/workbench/WorkbenchCanvas';
import { Plus, X, Sparkles, LayoutDashboard, Search, FolderOpen, Users, Lock, Globe, Heart, Library, PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IconBadge } from '@/components/workbench/IconBadge';
import { DASHBOARD_SECTION_GROUPS } from '@/components/workbench/workbenchSections';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { useDashboardVisibility } from '@/hooks/useDashboardVisibility';
import type { ReportData } from '@/data/reportSimulations';
import { cn } from '@/lib/utils';

type CanvasListItem = {
  id: string;
  title: string;
  content: unknown;
  created_at: string;
  updated_at: string;
  favorited: boolean;
  visibility?: 'private' | 'global' | 'shared';
  is_owner?: boolean;
  owner_email?: string;
  owner_name?: string;
  permission?: 'owner' | 'editor' | 'viewer';
};

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
  const { dashboardVisibility, handleVisibilityChange } = useDashboardVisibility();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { selectedTenantId } = useTenantStore();
  const effectiveTenantId = selectedTenantId || user?.tenant_id;
  const { canvasId: urlCanvasId } = useParams<{ canvasId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [canvasPanelCollapsed, setCanvasPanelCollapsed] = useState(false);
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

  // Can edit = owner or editor (viewer is read-only)
  const activeCanvasIsOwner = useMemo(() => {
    if (!activeTabId) return true;
    if (activeTabId.startsWith('new-')) return true; // New canvases are always owned
    const canvas = canvasList.find((c) => c.id === activeTabId);
    if (!canvas) return true; // Not loaded yet — assume owner until data arrives
    if (canvas.permission !== undefined) return canvas.permission === 'owner' || canvas.permission === 'editor';
    return canvas.is_owner !== false;
  }, [activeTabId, canvasList]);

  const filteredCanvases = useMemo(() => {
    const search = canvasSearch.trim().toLowerCase();
    if (!search) return canvasList;
    return canvasList.filter((canvas) => canvas.title.toLowerCase().includes(search));
  }, [canvasList, canvasSearch]);

  const groupedCanvases = useMemo(() => {
    const my: CanvasListItem[] = [];
    const global: CanvasListItem[] = [];
    const shared: CanvasListItem[] = [];
    for (const canvas of filteredCanvases) {
      if (canvas.is_owner !== false) my.push(canvas);
      else if (canvas.visibility === 'global') global.push(canvas);
      else shared.push(canvas);
    }
    return { my, global, shared };
  }, [filteredCanvases]);

  const handleAddDashboardSection = useCallback((sectionId: string) => {
    window.dispatchEvent(new CustomEvent('add-dashboard-section', { detail: { sectionId } }));
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
      <div className="h-[calc(100vh-4rem)] overflow-hidden bg-gradient-to-br from-slate-50/90 via-white to-sky-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950/80">
        <div className="flex h-full">
          <aside
            className={cn(
              'hidden lg:flex shrink-0 border-r border-slate-200/70 dark:border-slate-700/50 bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm flex-col transition-[width] duration-200 ease-out',
              canvasPanelCollapsed ? 'w-12' : 'w-72'
            )}
          >
            {canvasPanelCollapsed ? (
              <div className="flex flex-col items-center pt-3">
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={() => setCanvasPanelCollapsed(false)}>
                  <PanelLeftOpen className="h-5 w-5" />
                </Button>
              </div>
            ) : (
              <div className="flex flex-col h-full min-h-0">
                <div className="p-3 border-b border-slate-200/70 dark:border-slate-700/50">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">My Workbench</h3>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCanvasPanelCollapsed(true)}>
                      <PanelLeftClose className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleNewCanvas}>
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      New Canvas
                    </Button>
                  </div>
                </div>

                <div className="p-3 border-b border-slate-200/70 dark:border-slate-700/50">
                  <div className="flex items-center gap-1.5 mb-2 px-1">
                    <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <Input
                      placeholder="Search canvases..."
                      value={canvasSearch}
                      onChange={(e) => setCanvasSearch(e.target.value)}
                      className="h-7 text-xs bg-white dark:bg-slate-800/80"
                    />
                  </div>
                  <div className="space-y-2 max-h-[280px] overflow-y-auto">
                    {groupedCanvases.my.length > 0 && (
                      <div>
                        <p className="px-1 pb-0.5 text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                          <Lock className="h-2.5 w-2.5" /> My Canvases
                        </p>
                        {groupedCanvases.my.map((canvas) => (
                          <button
                            key={canvas.id}
                            type="button"
                            className={cn(
                              'group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
                              activeTabId === canvas.id
                                ? 'bg-violet-100/90 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 font-medium'
                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80'
                            )}
                            onClick={() => handleSelectCanvas(canvas.id)}
                          >
                            {canvas.favorited ? <Heart className="h-3 w-3 fill-rose-500 text-rose-500 shrink-0" /> : <FolderOpen className="h-3 w-3 text-slate-400 shrink-0" />}
                            <span className="truncate flex-1">{canvas.title}</span>
                            <X
                              className="h-3 w-3 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCanvas(canvas.id, canvas.title);
                              }}
                            />
                          </button>
                        ))}
                      </div>
                    )}
                    {groupedCanvases.global.length > 0 && (
                      <div>
                        <p className="px-1 pb-0.5 text-[10px] font-semibold text-blue-500 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1">
                          <Globe className="h-2.5 w-2.5" /> Global
                        </p>
                        {groupedCanvases.global.map((canvas) => (
                          <button key={canvas.id} type="button" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80" onClick={() => handleSelectCanvas(canvas.id)}>
                            <Globe className="h-3 w-3 text-blue-500 shrink-0" />
                            <span className="truncate flex-1">{canvas.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {groupedCanvases.shared.length > 0 && (
                      <div>
                        <p className="px-1 pb-0.5 text-[10px] font-semibold text-emerald-500 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                          <Users className="h-2.5 w-2.5" /> Shared with me
                        </p>
                        {groupedCanvases.shared.map((canvas) => (
                          <button key={canvas.id} type="button" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80" onClick={() => handleSelectCanvas(canvas.id)}>
                            <Users className="h-3 w-3 text-emerald-500 shrink-0" />
                            <span className="truncate flex-1">{canvas.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 min-h-0 p-3 border-t border-slate-200/70 dark:border-slate-700/50 overflow-y-auto">
                  <h3 className="px-2 py-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <IconBadge icon={Library} variant="sky" size="sm" rounded="lg" />
                    Dashboard Library
                  </h3>
                  <p className="mt-2.5 px-2 text-[13px] text-slate-500 dark:text-slate-400 leading-snug">
                    Add a full dashboard section to your canvas.
                  </p>
                  <div className="mt-3 space-y-3">
                    {DASHBOARD_SECTION_GROUPS.map((group) => (
                      <div key={group.label}>
                        <p className="px-2 text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">{group.label}</p>
                        <div className="space-y-0.5">
                          {group.items.map((item) => {
                            const Icon = item.icon;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-colors"
                                onClick={() => handleAddDashboardSection(item.id)}
                              >
                                <Icon className={cn('h-4 w-4 shrink-0', item.iconClass)} />
                                <span className="truncate">{item.title}</span>
                                <Plus className="h-3 w-3 text-slate-400 ml-auto shrink-0" />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </aside>

          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
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
                        setCanvasPanelCollapsed(false);
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
    </DashboardLayout>
  );
}
