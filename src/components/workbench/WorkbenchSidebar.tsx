import { useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutGrid, Library, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Search, Plus, Trash2, Heart, FolderOpen } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IconBadge } from '@/components/workbench/IconBadge';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { DASHBOARD_SECTION_GROUPS } from './workbenchSections';

export type CanvasListItem = { id: string; title: string; content: any; created_at: string; updated_at: string; favorited: boolean };

const appNavLinks = [
  { path: '/my-dashboard', label: 'My Workbench', icon: LayoutDashboard, variant: 'violet' as const },
  // Shared With Me, Team Folders, and Bookmarks are hidden until implemented
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

function SidebarContent({
  onItemClick,
  onToggleCollapse,
  pathname,
  onAddDashboardSection,
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
  onAddDashboardSection: (sectionId: string) => void;
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

      {/* Cohi Dashboard Library – predefined dashboard sections */}
      <div id="cohi-dashboard-library" className="flex-1 min-h-0 p-3 border-t border-slate-200/70 dark:border-slate-700/50">
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
                      onClick={() => {
                        onAddDashboardSection(item.id);
                        onItemClick?.();
                      }}
                    >
                      <Icon className={cn('h-4 w-4 shrink-0', item.iconClass)} />
                      <span className="truncate">{item.title}</span>
                      <Plus className="h-3 w-3 text-slate-400 ml-auto shrink-0 opacity-0 group-hover:opacity-100" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
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

  const closeSheet = () => onSidebarOpenChange(false);
  const location = useLocation();
  const collapsed = sidebarCollapsed ?? false;
  const onCollapsed = onSidebarCollapsedChange ?? (() => {});

  const handleAddDashboardSection = useCallback((sectionId: string) => {
    window.dispatchEvent(
      new CustomEvent('add-dashboard-section', { detail: { sectionId } }),
    );
  }, []);

  const sidebarBody = (
    <SidebarContent
      onItemClick={closeSheet}
      onToggleCollapse={!isMobile && !collapsed ? () => onCollapsed(true) : undefined}
      pathname={location.pathname}
      onAddDashboardSection={handleAddDashboardSection}
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
