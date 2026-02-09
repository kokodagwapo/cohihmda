import { useEffect, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutGrid, Folder, Share2, Library, Copy, Loader2, LayoutDashboard, Star, PanelLeftClose, PanelLeftOpen, Blocks, Search, Plus, Trash2, Heart, FolderOpen } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IconBadge } from '@/components/workbench/IconBadge';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { WidgetCatalog } from '@/components/widgets/catalog';
import type { WidgetDefinition } from '@/components/widgets/registry';

export type CanvasListItem = { id: string; title: string; content: any; created_at: string; updated_at: string; favorited: boolean };

const appNavLinks = [
  { path: '/my-dashboard', label: 'My Workbench', icon: LayoutDashboard, variant: 'violet' as const },
  { path: '/workbench/shared', label: 'Shared With Me', icon: Share2, variant: 'rose' as const },
  { path: '/workbench/team-folders', label: 'Team Folders', icon: Folder, variant: 'slate' as const },
  { path: '/workbench/favorites', label: 'Bookmarks', icon: Star, variant: 'amber' as const },
  { label: 'Cohi Dashboard Library', icon: Library, variant: 'sky' as const, scrollTarget: 'cohi-dashboard-library' },
];

export interface WorkbenchSidebarProps {
  sidebarOpen: boolean;
  onSidebarOpenChange: (open: boolean) => void;
  sidebarCollapsed?: boolean;
  onSidebarCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
  /** Canvas list management (passed from MyDashboard) */
  canvasList?: CanvasListItem[];
  canvasSearch?: string;
  onCanvasSearchChange?: (search: string) => void;
  activeCanvasId?: string | null;
  onSelectCanvas?: (id: string) => void;
  onNewCanvas?: () => void;
  onDeleteCanvas?: (id: string, title: string) => void;
}

type TemplateRow = { id: string; name: string; category: string; description: string | null };

function SidebarContent({
  onItemClick,
  onToggleCollapse,
  pathname,
  templates,
  onCopyTemplate,
  copyingId,
  onAddWidget,
  canvasList,
  canvasSearch,
  onCanvasSearchChange,
  activeCanvasId,
  onSelectCanvas,
  onNewCanvas,
  onDeleteCanvas,
}: {
  onItemClick?: () => void;
  onToggleCollapse?: () => void;
  pathname: string;
  templates: TemplateRow[];
  onCopyTemplate: (id: string) => void;
  copyingId: string | null;
  onAddWidget: (def: WidgetDefinition) => void;
  canvasList?: CanvasListItem[];
  canvasSearch?: string;
  onCanvasSearchChange?: (search: string) => void;
  activeCanvasId?: string | null;
  onSelectCanvas?: (id: string) => void;
  onNewCanvas?: () => void;
  onDeleteCanvas?: (id: string, title: string) => void;
}) {
  const filteredCanvases = canvasSearch?.trim()
    ? (canvasList ?? []).filter((c) => c.title.toLowerCase().includes(canvasSearch.trim().toLowerCase()))
    : (canvasList ?? []);

  return (
    <div className="flex flex-col h-full">
      {/* Header with collapse toggle */}
      <div className="p-3 border-b border-slate-200/70 dark:border-slate-700/50">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <h3 className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Workbench
          </h3>
          {onToggleCollapse && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={onToggleCollapse}
              aria-label="Hide sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          )}
        </div>
        <nav className="mt-1.5 space-y-0.5">
          {appNavLinks.map(({ path, label, icon: Icon, variant, scrollTarget }) => {
            const active = path ? pathname === path || pathname.startsWith(path) : false;
            const cls = cn(
              'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
              active
                ? 'bg-violet-100/90 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 shadow-sm'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80'
            );

            const handleClick = () => {
              if (scrollTarget) {
                document.getElementById(scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
              onItemClick?.();
            };

            return path ? (
              <Link key={label} to={path} onClick={handleClick} className={cls}>
                <IconBadge icon={Icon} variant={variant} size="sm" rounded="lg" />
                <span className="truncate">{label}</span>
              </Link>
            ) : (
              <button key={label} type="button" onClick={handleClick} className={cls}>
                <IconBadge icon={Icon} variant={variant} size="sm" rounded="lg" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Canvas list */}
      {canvasList !== undefined && (
        <div className="p-3 border-b border-slate-200/70 dark:border-slate-700/50">
          <div className="flex items-center justify-between gap-2 px-1 mb-2">
            <h3 className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <FolderOpen className="h-3.5 w-3.5" />
              Canvases
              <span className="text-slate-400 dark:text-slate-500 font-normal">({canvasList.length})</span>
            </h3>
            {onNewCanvas && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-md text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/30"
                onClick={onNewCanvas}
                title="New canvas"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {canvasList.length > 3 && onCanvasSearchChange && (
            <div className="flex items-center gap-1.5 mb-2 px-1">
              <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <Input
                placeholder="Search…"
                value={canvasSearch ?? ''}
                onChange={(e) => onCanvasSearchChange(e.target.value)}
                className="h-7 text-xs bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700"
              />
            </div>
          )}

          <div className="space-y-0.5 max-h-[240px] overflow-y-auto">
            {filteredCanvases.length > 0 ? filteredCanvases.map((c) => (
              <button
                key={c.id}
                type="button"
                className={cn(
                  'group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
                  activeCanvasId === c.id
                    ? 'bg-violet-100/90 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 font-medium'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80'
                )}
                onClick={() => onSelectCanvas?.(c.id)}
              >
                {c.favorited && <Heart className="h-3 w-3 fill-rose-500 text-rose-500 shrink-0" />}
                <span className="truncate flex-1">{c.title}</span>
                {onDeleteCanvas && (
                  <Trash2
                    className="h-3 w-3 text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteCanvas(c.id, c.title);
                    }}
                  />
                )}
              </button>
            )) : canvasList.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-3">
                No canvases yet
              </p>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-2">
                No matches
              </p>
            )}
          </div>
        </div>
      )}

      {/* Cohi Dashboard Library */}
      <div id="cohi-dashboard-library" className="flex-1 min-h-0 p-3 border-t border-slate-200/70 dark:border-slate-700/50">
        <h3 className="px-2 py-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <IconBadge icon={Library} variant="sky" size="sm" rounded="lg" />
          Cohi Dashboard Library
        </h3>
        <p className="mt-2.5 px-2 text-[13px] text-slate-500 dark:text-slate-400 leading-snug">
          Browse Cohi-curated templates. Copy any dashboard into your workbench to customize.
        </p>
        {templates.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-slate-200/80 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-800/30 p-5 text-center">
            <IconBadge icon={Folder} variant="slate" size="lg" rounded="xl" className="mx-auto mb-2.5" />
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">No templates yet</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-500 mt-0.5">Executive, Sales, Ops, Fallout, and more</p>
          </div>
        ) : (
          <div className="mt-3 space-y-2.5">
            {templates.map((t) => (
              <div
                key={t.id}
                className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white/90 dark:bg-slate-800/50 p-3.5 shadow-sm hover:shadow transition-shadow duration-200"
              >
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{t.name}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{t.category} · {t.description || 'Template'}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2.5 h-8 gap-2 rounded-lg border-slate-200/80 dark:border-slate-700/80 hover:border-emerald-300 dark:hover:border-emerald-700/60 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/20 text-xs transition-colors"
                  onClick={() => onCopyTemplate(t.id)}
                  disabled={copyingId === t.id}
                >
                  {copyingId === t.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  )}
                  Copy to My Workbench
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Widget Library */}
      <div className="p-3 border-t border-slate-200/70 dark:border-slate-700/50">
        <h3 className="px-2 py-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <IconBadge icon={Blocks} variant="violet" size="sm" rounded="lg" />
          Widget Library
        </h3>
        <p className="mt-2 px-2 text-[13px] text-slate-500 dark:text-slate-400 leading-snug">
          Add individual KPIs, charts, and tables to your canvas.
        </p>
        <div className="mt-2.5">
          <WidgetCatalog onAddWidget={onAddWidget} />
        </div>
      </div>
    </div>
  );
}

export function WorkbenchSidebar({
  sidebarOpen,
  onSidebarOpenChange,
  sidebarCollapsed,
  onSidebarCollapsedChange,
  className,
  canvasList,
  canvasSearch,
  onCanvasSearchChange,
  activeCanvasId,
  onSelectCanvas,
  onNewCanvas,
  onDeleteCanvas,
}: WorkbenchSidebarProps) {
  const isMobile = useIsMobile();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [copyingId, setCopyingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const tRes = await api.request<{ templates: TemplateRow[] }>('/api/workbench/dashboard-templates');
        setTemplates(tRes?.templates ?? []);
      } catch {
        setTemplates([]);
      }
    })();
  }, []);

  const onCopyTemplate = async (id: string) => {
    setCopyingId(id);
    try {
      await api.request(`/api/workbench/dashboard-templates/${id}/copy`, { method: 'POST', body: JSON.stringify({}) });
      onSidebarOpenChange(false);
    } catch {
      // keep UI; toast could be added
    } finally {
      setCopyingId(null);
    }
  };

  const closeSheet = () => onSidebarOpenChange(false);
  const location = useLocation();
  const collapsed = sidebarCollapsed ?? false;
  const onCollapsed = onSidebarCollapsedChange ?? (() => {});

  const handleAddWidget = useCallback((def: WidgetDefinition) => {
    window.dispatchEvent(
      new CustomEvent('add-registry-widget', {
        detail: {
          definitionId: def.id,
          name: def.name,
          defaultSize: def.defaultSize,
        },
      }),
    );
  }, []);

  const sidebarBody = (
    <SidebarContent
      onItemClick={closeSheet}
      onToggleCollapse={!isMobile && !collapsed ? () => onCollapsed(true) : undefined}
      pathname={location.pathname}
      templates={templates}
      onCopyTemplate={onCopyTemplate}
      copyingId={copyingId}
      onAddWidget={handleAddWidget}
      canvasList={canvasList}
      canvasSearch={canvasSearch}
      onCanvasSearchChange={onCanvasSearchChange}
      activeCanvasId={activeCanvasId}
      onSelectCanvas={onSelectCanvas}
      onNewCanvas={onNewCanvas}
      onDeleteCanvas={onDeleteCanvas}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={sidebarOpen} onOpenChange={onSidebarOpenChange}>
        <SheetContent side="left" className="w-[280px] p-0 flex flex-col border-r border-slate-200/70 dark:border-slate-700/50">
          <SheetHeader className="px-4 py-3.5 border-b border-slate-200/70 dark:border-slate-700/50">
            <SheetTitle className="text-base font-semibold flex items-center gap-2">
              <IconBadge icon={LayoutGrid} variant="violet" size="sm" rounded="lg" />
              Workbench
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">{sidebarBody}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      className={cn(
        'flex-shrink-0 border-r border-slate-200/70 dark:border-slate-700/50 bg-white/70 dark:bg-slate-900/70 backdrop-blur-sm flex flex-col shadow-sm shadow-slate-200/20 dark:shadow-none transition-[width] duration-200 ease-out',
        collapsed ? 'w-12' : 'w-64',
        className
      )}
    >
      {collapsed ? (
        <div className="flex flex-col items-center pt-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => onCollapsed(false)}
            aria-label="Open sidebar"
          >
            <PanelLeftOpen className="h-5 w-5" />
          </Button>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">{sidebarBody}</div>
      )}
    </aside>
  );
}
