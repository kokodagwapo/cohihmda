import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { api } from '@/lib/api';
import { useTenantStore } from '@/stores/tenantStore';
import { useAuth } from '@/contexts/AuthContext';
import { WorkbenchCanvas } from '@/components/workbench/WorkbenchCanvas';
import { Plus, X, Sparkles, LayoutPanelLeft, Pin, PinOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { useDashboardVisibility } from '@/hooks/useDashboardVisibility';
import type { ReportData } from '@/data/reportSimulations';
import { cn } from '@/lib/utils';
import { useWorkbenchNav } from '@/hooks/useWorkbenchNav';
import {
  WORKBENCH_CHAT_HANDOFF_STATE_KEY,
  draftScopeIdForCanvasTab,
  getMyDashboardCanvasIdFromPath,
  lookupWorkbenchDraftTab,
  rememberWorkbenchDraftTab,
  resetActiveWorkbenchDraftSession,
  setActiveWorkbenchDraftScope,
  getOrCreateActiveWorkbenchDraftScope,
  COHI_WORKBENCH_FOCUS_CANVAS_EVENT,
  dispatchCohiChatResume,
  type WorkbenchChatHandoffLocationState,
} from '@/lib/workbench/workbenchChatHandoff';
import {
  buildActiveContextFromTab,
  dispatchWorkbenchActiveContext,
  COHI_WORKBENCH_REQUEST_NEW_TAB_EVENT,
  COHI_WORKBENCH_NEW_TAB_READY_EVENT,
  type WorkbenchRequestNewTabDetail,
  type WorkbenchNewTabReadyDetail,
} from '@/lib/workbench/workbenchChatScopeSync';

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
  const autoOpenReportBuilder =
    searchParams.get("reportBuilder") === "1";
  const navigate = useNavigate();
  const location = useLocation();
  const initialUrlCanvasIdRef = useRef<string | undefined>(urlCanvasId);

  // Keep in sync when the route param changes (same component instance); hydration only re-runs on tenant change.
  useEffect(() => {
    if (urlCanvasId != null && urlCanvasId !== '') {
      initialUrlCanvasIdRef.current = urlCanvasId;
    }
  }, [urlCanvasId]);

  const [canvasList, setCanvasList] = useState<CanvasListItem[]>([]);
  const [loadCanvasId, setLoadCanvasId] = useState<string | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const [isHydratingWorkbench, setIsHydratingWorkbench] = useState(true);

  // Track which canvases the user has "open" as tabs (tenant-scoped)
  const persisted = useRef(loadPersistedTabs(effectiveTenantId));
  const [openTabs, setOpenTabs] = useState<string[]>(persisted.current.tabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(persisted.current.active);
  // Map temp tab IDs → readable titles for unsaved canvases
  const [tabTitles, setTabTitles] = useState<Record<string, string>>({});
  /** Per-tab draft scope ids for unified workbench chat widget handoff. */
  const [tabDraftScopes, setTabDraftScopes] = useState<Record<string, string>>({});
  const tabDraftScopesRef = useRef(tabDraftScopes);
  tabDraftScopesRef.current = tabDraftScopes;
  // Track which tabs have unsaved changes (dirty state from canvas autosave)
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());

  const reportBuilderSearch = autoOpenReportBuilder ? "?reportBuilder=1" : "";

  /* ─── Backward compat: redirect ?canvas=xxx to slug-based URL ─── */
  useEffect(() => {
    const legacyCanvas = searchParams.get('canvas');
    if (legacyCanvas) {
      navigate(`/my-dashboard/${legacyCanvas}${reportBuilderSearch}`, { replace: true });
    }
  }, [searchParams, navigate, reportBuilderSearch]);

  /* ─── Persist tabs to localStorage when they change ─── */
  useEffect(() => {
    persistTabs(openTabs, activeTabId, effectiveTenantId);
  }, [openTabs, activeTabId, effectiveTenantId]);

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
      navigate(`/my-dashboard/new${reportBuilderSearch}`, { replace: true });
    } else {
      navigate(`/my-dashboard/${tabId}${reportBuilderSearch}`, { replace: true });
    }
  }, [navigate, reportBuilderSearch]);

  /** Focus a saved canvas tab when unified chat edits a widget on that canvas. */
  useEffect(() => {
    const handler = (e: Event) => {
      const canvasId = (e as CustomEvent<{ canvasId?: string }>).detail?.canvasId;
      if (!canvasId || canvasId.startsWith('new-')) return;
      setOpenTabs((prev) => (prev.includes(canvasId) ? prev : [...prev, canvasId]));
      setActiveTabId(canvasId);
      setLoadCanvasId(canvasId);
      updateUrl(canvasId);
    };
    window.addEventListener(COHI_WORKBENCH_FOCUS_CANVAS_EVENT, handler);
    return () =>
      window.removeEventListener(COHI_WORKBENCH_FOCUS_CANVAS_EVENT, handler);
  }, [updateUrl]);

  const fetchCanvases = useCallback(async (): Promise<CanvasListItem[]> => {
    try {
      const qs = effectiveTenantId ? `?tenant_id=${encodeURIComponent(effectiveTenantId)}` : '';
      const res = await api.request<{ canvases: CanvasListItem[] }>(`/api/workbench/canvases${qs}`);
      const list = res?.canvases ?? [];
      setCanvasList(list);
      return list;
    } catch {
      setCanvasList([]);
      return [];
    }
  }, [effectiveTenantId]);

  /* ─── Deterministic workbench hydration per effective tenant ─── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsHydratingWorkbench(true);
      setOpenTabs([]);
      setActiveTabId(null);
      setLoadCanvasId(null);

      const canvases = await fetchCanvases();
      if (cancelled) return;

      const availableIds = new Set(canvases.map((c) => c.id));
      const { tabs: persistedTabsRaw, active: persistedActiveRaw } = loadPersistedTabs(effectiveTenantId);
      const persistedTabs = persistedTabsRaw.filter((id) => availableIds.has(id));
      const persistedActive = persistedActiveRaw && availableIds.has(persistedActiveRaw) ? persistedActiveRaw : null;
      const initialUrlCanvasId = initialUrlCanvasIdRef.current;

      if (initialUrlCanvasId === 'new') {
        const newTabId = `new-${Date.now()}`;
        setOpenTabs([...persistedTabs, newTabId]);
        setActiveTabId(newTabId);
        setLoadCanvasId(null);
        setCanvasKey((k) => k + 1);
        setDirtyTabs(new Set());
        setTabTitles({});
        setIsHydratingWorkbench(false);
        return;
      }

      // Prefer the URL canvas id whenever present — including brand-new canvases that are not
      // in GET /api/workbench/canvases yet (that list is cached ~30s). Otherwise we fall through to
      // persisted tabs and re-open the previous deep-dive canvas.
      const urlRequested =
        initialUrlCanvasId && initialUrlCanvasId !== 'new' ? initialUrlCanvasId : null;

      const nextTabs = [...persistedTabs];
      let nextActive: string | null = null;

      if (urlRequested) {
        if (!nextTabs.includes(urlRequested)) nextTabs.push(urlRequested);
        nextActive = urlRequested;
      } else if (persistedActive) {
        if (!nextTabs.includes(persistedActive)) nextTabs.push(persistedActive);
        nextActive = persistedActive;
      } else if (nextTabs.length > 0) {
        nextActive = nextTabs[nextTabs.length - 1];
      }

      if (nextActive) {
        setOpenTabs(nextTabs);
        setActiveTabId(nextActive);
        setLoadCanvasId(nextActive);
        navigate(`/my-dashboard/${nextActive}${reportBuilderSearch}`, { replace: true });
      } else {
        const newTabId = `new-${Date.now()}`;
        setOpenTabs([newTabId]);
        setActiveTabId(newTabId);
        setLoadCanvasId(null);
        setCanvasKey((k) => k + 1);
        navigate(`/my-dashboard/new${reportBuilderSearch}`, { replace: true });
      }

      setDirtyTabs(new Set());
      setTabTitles({});
      setIsHydratingWorkbench(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveTenantId, fetchCanvases, navigate, reportBuilderSearch]);

  /* ─── Respond to URL changes post-hydration only when canvas is accessible ─── */
  useEffect(() => {
    if (isHydratingWorkbench) return;
    if (!urlCanvasId || urlCanvasId === 'new') return;
    if (urlCanvasId === activeTabId) return;
    const isAccessible = canvasList.some((c) => c.id === urlCanvasId);
    // Allow opening newly-created canvases immediately, even before sidebar list refreshes.
    if (!isAccessible) {
      setOpenTabs((prev) => (prev.includes(urlCanvasId) ? prev : [...prev, urlCanvasId]));
      setActiveTabId(urlCanvasId);
      setLoadCanvasId(urlCanvasId);
      void fetchCanvases();
      return;
    }
    setOpenTabs((prev) => (prev.includes(urlCanvasId) ? prev : [...prev, urlCanvasId]));
    setActiveTabId(urlCanvasId);
    // Only trigger a load if this is genuinely a different canvas being opened,
    // not a URL update from saving the current canvas
    setLoadCanvasId((prev) => {
      if (prev === urlCanvasId) return prev;
      return urlCanvasId;
    });
  }, [urlCanvasId, activeTabId, canvasList, isHydratingWorkbench]);

  /* ─── External-edit signal ───
   * When another surface (e.g. SaveToWorkbenchModal) appends a widget to a
   * canvas the user already had open and then navigates to /my-dashboard/:id,
   * the URL effect above short-circuits (urlCanvasId === activeTabId), so
   * WorkbenchCanvas never refetches. The modal passes `state.reloadCanvas`
   * (timestamp) to force a remount via canvasKey, which re-runs the canvas
   * fetch and discards any stale in-memory layout.
   */
  const reloadCanvasSignal = (location.state as { reloadCanvas?: number } | null)?.reloadCanvas;
  useEffect(() => {
    if (!reloadCanvasSignal || !urlCanvasId) return;
    setLoadCanvasId(urlCanvasId);
    setCanvasKey((k) => k + 1);
    // Clear the signal so subsequent renders / back-nav don't re-trigger.
    navigate(location.pathname, { replace: true, state: null });
  }, [reloadCanvasSignal, urlCanvasId, navigate, location.pathname]);

  /** Unified workbench chat → canvas tab handoff (open/focus draft scope tab). */
  useEffect(() => {
    if (isHydratingWorkbench) return;
    const handoff = (location.state as WorkbenchChatHandoffLocationState | null)?.[
      WORKBENCH_CHAT_HANDOFF_STATE_KEY
    ];
    if (!handoff) return;

    const clearHandoffState = () => {
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    };

    if (handoff.openNewTab) {
      const urlCanvasId = getMyDashboardCanvasIdFromPath(location.pathname);
      const onSavedCanvas =
        urlCanvasId &&
        activeTabId &&
        !activeTabId.startsWith('new-') &&
        loadCanvasId === urlCanvasId;
      if (onSavedCanvas) {
        clearHandoffState();
        return;
      }
      const newTabId = `new-${Date.now()}`;
      setTabDraftScopes((prev) => ({ ...prev, [newTabId]: handoff.draftScopeId }));
      rememberWorkbenchDraftTab(handoff.draftScopeId, newTabId);
      setOpenTabs((prev) => [...prev, newTabId]);
      setActiveTabId(newTabId);
      setLoadCanvasId(null);
      setCanvasKey((k) => k + 1);
      updateUrl(null);
      clearHandoffState();
      return;
    }

    if (handoff.activateDraftScopeId) {
      const urlCanvasId = getMyDashboardCanvasIdFromPath(location.pathname);
      const stayingOnSavedCanvas =
        urlCanvasId &&
        activeTabId === urlCanvasId &&
        loadCanvasId === urlCanvasId;
      if (stayingOnSavedCanvas) {
        const scopeId = draftScopeIdForCanvasTab(urlCanvasId);
        setTabDraftScopes((prev) => ({ ...prev, [urlCanvasId]: scopeId }));
        setActiveWorkbenchDraftScope(scopeId);
        rememberWorkbenchDraftTab(scopeId, urlCanvasId);
        clearHandoffState();
        return;
      }

      const boundTabId = lookupWorkbenchDraftTab(handoff.activateDraftScopeId);
      if (boundTabId) {
        setTabDraftScopes((prev) => ({
          ...prev,
          [boundTabId]: handoff.activateDraftScopeId!,
        }));
        if (!openTabs.includes(boundTabId)) {
          setOpenTabs((prev) => [...prev, boundTabId]);
        }
        setActiveTabId(boundTabId);
        if (boundTabId.startsWith('new-')) {
          setLoadCanvasId(null);
          setCanvasKey((k) => k + 1);
        } else {
          setLoadCanvasId(boundTabId);
        }
        updateUrl(boundTabId.startsWith('new-') ? null : boundTabId);
      } else if (activeTabId?.startsWith('new-')) {
        setTabDraftScopes((prev) => ({
          ...prev,
          [activeTabId]: handoff.activateDraftScopeId!,
        }));
        rememberWorkbenchDraftTab(handoff.activateDraftScopeId, activeTabId);
      }
      clearHandoffState();
    }

    if (handoff.resumeConversationId) {
      dispatchCohiChatResume(handoff.resumeConversationId, "workbench");
    }

    if (!handoff.openNewTab && !handoff.activateDraftScopeId) {
      clearHandoffState();
    }
  }, [
    isHydratingWorkbench,
    location.state,
    location.pathname,
    location.search,
    navigate,
    openTabs,
    activeTabId,
    loadCanvasId,
    updateUrl,
  ]);

  // Open a canvas tab (from sidebar click)
  const handleSelectCanvas = useCallback((id: string) => {
    setOpenTabs((prev) => prev.includes(id) ? prev : [...prev, id]);
    setActiveTabId(id);
    setLoadCanvasId(id);
    updateUrl(id);
  }, [updateUrl]);

  // Create a new blank canvas tab
  const handleNewCanvas = useCallback(() => {
    resetActiveWorkbenchDraftSession();
    const draftScopeId = getOrCreateActiveWorkbenchDraftScope();
    const newTabId = `new-${Date.now()}`;
    setTabDraftScopes((prev) => ({ ...prev, [newTabId]: draftScopeId }));
    setOpenTabs((prev) => [...prev, newTabId]);
    setActiveTabId(newTabId);
    setLoadCanvasId(null);
    setCanvasKey((k) => k + 1);
    updateUrl(null);
    dispatchWorkbenchActiveContext(
      buildActiveContextFromTab({
        tabId: newTabId,
        tabTitle: 'New Canvas',
        tabDraftScopes: { [newTabId]: draftScopeId },
      }),
    );
  }, [updateUrl]);

  /** New canvas tab requested from unified workbench chat (confirm-first flow). */
  useEffect(() => {
    const handler = (e: Event) => {
      const { requestId } = (e as CustomEvent<WorkbenchRequestNewTabDetail>).detail ?? {};
      if (!requestId) return;
      resetActiveWorkbenchDraftSession();
      const draftScopeId = getOrCreateActiveWorkbenchDraftScope();
      const newTabId = `new-${Date.now()}`;
      setTabDraftScopes((prev) => ({ ...prev, [newTabId]: draftScopeId }));
      setOpenTabs((prev) => [...prev, newTabId]);
      setActiveTabId(newTabId);
      setLoadCanvasId(null);
      setCanvasKey((k) => k + 1);
      updateUrl(null);
      const context = buildActiveContextFromTab({
        tabId: newTabId,
        tabTitle: 'New Canvas',
        tabDraftScopes: { [newTabId]: draftScopeId },
      });
      dispatchWorkbenchActiveContext(context);
      window.dispatchEvent(
        new CustomEvent<WorkbenchNewTabReadyDetail>(COHI_WORKBENCH_NEW_TAB_READY_EVENT, {
          detail: { requestId, context },
        }),
      );
    };
    window.addEventListener(COHI_WORKBENCH_REQUEST_NEW_TAB_EVENT, handler);
    return () =>
      window.removeEventListener(COHI_WORKBENCH_REQUEST_NEW_TAB_EVENT, handler);
  }, [updateUrl]);

  // Close a tab (with unsaved warning); navigates to hub when last tab closes
  const handleCloseTab = useCallback((tabId: string) => {
    if (tabId.startsWith('new-') || dirtyTabs.has(tabId)) {
      const confirmed = window.confirm('This canvas has unsaved changes. Close anyway?');
      if (!confirmed) return;
      setDirtyTabs((prev) => { const next = new Set(prev); next.delete(tabId); return next; });
    }
    setOpenTabs((prev) => {
      const next = prev.filter((t) => t !== tabId);
      if (next.length === 0) {
        navigate('/workbench');
        return next;
      }
      if (activeTabId === tabId) {
        const newActive = next[next.length - 1];
        setActiveTabId(newActive);
        if (!newActive.startsWith('new-')) {
          setLoadCanvasId(newActive);
        } else {
          setLoadCanvasId(null);
          setCanvasKey((k) => k + 1);
        }
        updateUrl(newActive);
      }
      return next;
    });
  }, [activeTabId, updateUrl, dirtyTabs, navigate]);

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

  // Callback from WorkbenchCanvas after a canvas is saved (new or existing).
  // Does NOT re-fetch the canvas or cause a remount — only updates tabs/URL.
  const handleCanvasSaved = useCallback((savedId: string, title: string) => {
    const currentKnownTitle =
      tabTitles[savedId] ?? canvasList.find((c) => c.id === savedId)?.title ?? null;
    const isNewTabPromotion = !!activeTabId && activeTabId.startsWith('new-');
    const isNoOpExistingSave =
      !isNewTabPromotion &&
      activeTabId === savedId &&
      currentKnownTitle === title;

    if (isNoOpExistingSave) return;

    const promotedFromTabId =
      isNewTabPromotion && activeTabId ? activeTabId : null;
    const greenfieldDraftId = promotedFromTabId
      ? tabDraftScopesRef.current[promotedFromTabId]
      : undefined;
    const canvasDraftScope = draftScopeIdForCanvasTab(savedId);

    setOpenTabs((prev) => {
      const currentActive = activeTabId;
      if (currentActive && currentActive.startsWith('new-')) {
        return prev.map((t) => t === currentActive ? savedId : t);
      }
      return prev.includes(savedId) ? prev : [...prev, savedId];
    });
    setActiveTabId(savedId);
    setTabTitles((prev) => ({ ...prev, [savedId]: title }));
    setTabDraftScopes((prev) => {
      const next = { ...prev };
      if (promotedFromTabId) {
        delete next[promotedFromTabId];
      }
      next[savedId] = canvasDraftScope;
      return next;
    });
    rememberWorkbenchDraftTab(canvasDraftScope, savedId);
    if (greenfieldDraftId) {
      rememberWorkbenchDraftTab(greenfieldDraftId, savedId);
    }
    setActiveWorkbenchDraftScope(canvasDraftScope);
    updateUrl(savedId);
    // Update the canvas list in the background — don't block or re-trigger load
    fetchCanvases().catch(() => {});
  }, [activeTabId, canvasList, fetchCanvases, tabTitles, updateUrl]);

  const handleCanvasLoaded = useCallback(() => {
    fetchCanvases().catch(() => {});
  }, [fetchCanvases]);

  // Get tab title from canvas list or override titles
  const getTabTitle = useCallback((tabId: string) => {
    if (tabId.startsWith('new-')) return 'New Canvas';
    if (tabTitles[tabId]) return tabTitles[tabId];
    const canvas = canvasList.find((c) => c.id === tabId);
    return canvas?.title || 'Untitled';
  }, [tabTitles, canvasList]);

  const emitActiveWorkbenchContext = useCallback(
    (tabId: string | null) => {
      if (!tabId) return;
      dispatchWorkbenchActiveContext(
        buildActiveContextFromTab({
          tabId,
          tabTitle: getTabTitle(tabId),
          tabDraftScopes: tabDraftScopesRef.current,
        }),
      );
    },
    [getTabTitle],
  );

  useEffect(() => {
    if (isHydratingWorkbench || !activeTabId) return;
    emitActiveWorkbenchContext(activeTabId);
  }, [activeTabId, isHydratingWorkbench, emitActiveWorkbenchContext]);

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

  // Workbench nav for pinning from open canvas
  const { canvases: navCanvases, favoriteUpdatingIds: navFavUpdating, toggleCanvasFavorite } = useWorkbenchNav();
  const activeCanvasFavorited = useMemo(() => {
    if (!activeTabId || activeTabId.startsWith('new-')) return false;
    return navCanvases.find((c) => c.id === activeTabId)?.favorited ?? false;
  }, [activeTabId, navCanvases]);

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
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <div className="flex items-center border-b border-slate-200/70 dark:border-slate-700/50 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm px-1 shrink-0 min-h-[37px] z-10">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 rounded-md text-xs font-medium text-slate-500 hover:text-violet-600 dark:text-slate-400 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/30 gap-1 px-2 mr-1"
                onClick={() => navigate('/workbench')}
                title="Back to Workbench Hub"
              >
                <LayoutPanelLeft className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Hub</span>
              </Button>
              <div className="h-5 w-px bg-slate-200 dark:bg-slate-700 shrink-0 mr-1" />
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
              {activeTabId && !activeTabId.startsWith('new-') && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 ml-1 shrink-0 rounded-md text-slate-500 hover:text-amber-500 dark:text-slate-400 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50"
                  onClick={() => void toggleCanvasFavorite(activeTabId, !activeCanvasFavorited)}
                  disabled={navFavUpdating.has(activeTabId)}
                  title={activeCanvasFavorited ? 'Unpin from favorites' : 'Pin to favorites'}
                >
                  {activeCanvasFavorited ? <PinOff className="h-3.5 w-3.5 text-amber-500" /> : <Pin className="h-3.5 w-3.5" />}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 ml-1 shrink-0 rounded-md text-slate-500 hover:text-violet-600 dark:text-slate-400 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/30"
                onClick={handleNewCanvas}
                title="New canvas (new board + new chat scope)"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden">
              {isHydratingWorkbench ? (
                <div className="flex items-center justify-center h-full text-slate-500 dark:text-slate-400">
                  Loading workbench...
                </div>
              ) : showEmptyState ? (
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
                      onClick={handleNewCanvas}
                    >
                      <Plus className="h-4 w-4" />
                      Open New Canvas
                    </Button>
                  </div>
                </div>
              ) : (
                <WorkbenchCanvas
                  key={canvasKey}
                  loadCanvasId={loadCanvasId}
                  chatDraftScopeId={
                    activeTabId && !activeTabId.startsWith("new-")
                      ? draftScopeIdForCanvasTab(activeTabId)
                      : activeTabId
                        ? tabDraftScopes[activeTabId]
                        : undefined
                  }
                  onLoaded={handleCanvasLoaded}
                  onSaved={handleCanvasSaved}
                  onDirtyChange={handleDirtyChange}
                  tenantId={effectiveTenantId}
                  isOwner={activeCanvasIsOwner}
                  autoOpenReportBuilder={autoOpenReportBuilder}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
