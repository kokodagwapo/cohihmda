import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutGrid, Folder, Share2, Library, Copy, Loader2, LayoutDashboard, Star, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { IconBadge } from '@/components/workbench/IconBadge';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
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
}

type TemplateRow = { id: string; name: string; category: string; description: string | null };

function SidebarContent({
  onItemClick,
  onToggleCollapse,
  pathname,
  templates,
  onCopyTemplate,
  copyingId,
}: {
  onItemClick?: () => void;
  onToggleCollapse?: () => void;
  pathname: string;
  templates: TemplateRow[];
  onCopyTemplate: (id: string) => void;
  copyingId: string | null;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* App / Top navigation menu */}
      <div className="p-3 border-b border-slate-200/70 dark:border-slate-700/50">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <h3 className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Left Panel
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
            const className = cn(
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
              <Link key={label} to={path} onClick={handleClick} className={className}>
                <IconBadge icon={Icon} variant={variant} size="sm" rounded="lg" />
                <span className="truncate">{label}</span>
              </Link>
            ) : (
              <button key={label} type="button" onClick={handleClick} className={className}>
                <IconBadge icon={Icon} variant={variant} size="sm" rounded="lg" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </nav>
      </div>

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
    </div>
  );
}

export function WorkbenchSidebar({ sidebarOpen, onSidebarOpenChange, sidebarCollapsed, onSidebarCollapsedChange, className }: WorkbenchSidebarProps) {
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

  const sidebarBody = (
    <SidebarContent
      onItemClick={closeSheet}
      onToggleCollapse={!isMobile && !collapsed ? () => onCollapsed(true) : undefined}
      pathname={location.pathname}
      templates={templates}
      onCopyTemplate={onCopyTemplate}
      copyingId={copyingId}
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
