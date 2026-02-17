import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Filter,
  ArrowLeftRight,
  Shield,
  ClipboardList,
  Calculator,
  Target,
  TrendingUp,
  LineChart,
  PanelLeftClose,
  PanelLeftOpen,
  FileText,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { IconBadge } from '@/components/workbench/IconBadge';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

const topTieringNavLinks = [
  { path: '/loan-funnel', label: 'Loan Funnel', icon: Filter, variant: 'amber' as const },
  { path: '/performance/toptiering-comparison', label: 'TopTiering Comparison', icon: ArrowLeftRight, variant: 'violet' as const },
  { path: '/credit-risk-management', label: 'Credit Risk Management', icon: Shield, variant: 'mint' as const },
  { path: '/company-scorecard', label: 'Company Scorecard', icon: ClipboardList, variant: 'violet' as const },
  { path: '/performance/financial-modeling-sandbox', label: 'Financial Modeling', icon: Calculator, variant: 'sky' as const },
  { path: '/sales-scorecard', label: 'Sales Scorecard', icon: Target, variant: 'sky' as const },
  { path: '/sales-trends', label: 'Sales Trends', icon: TrendingUp, variant: 'mint' as const },
  { path: '/performance/operation-scorecard', label: 'Operations Scorecard', icon: Target, variant: 'sky' as const },
  { path: '/performance/operation-scorecard-trends', label: 'Operations Trends', icon: LineChart, variant: 'fuchsia' as const },
  { path: '/loan-detail', label: 'Loan Detail', icon: FileText, variant: 'sky' as const },
  { path: '/my-dashboard', label: 'My Workbench', icon: LayoutDashboard, variant: 'violet' as const },
];

export interface TopTieringSidebarProps {
  sidebarOpen: boolean;
  onSidebarOpenChange: (open: boolean) => void;
  sidebarCollapsed?: boolean;
  onSidebarCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
}

function SidebarNav({
  onItemClick,
  onToggleCollapse,
  pathname,
}: {
  onItemClick?: () => void;
  onToggleCollapse?: () => void;
  pathname: string;
}) {
  return (
    <div className="flex flex-col h-full p-3">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 mb-1.5">
        <h3 className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          Menu
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
      <nav className="space-y-0.5 flex-1 overflow-y-auto">
        {topTieringNavLinks.map(({ path, label, icon: Icon, variant }) => {
          const active = pathname === path || (path !== '/' && pathname.startsWith(path));
          return (
            <Link
              key={path}
              to={path}
              onClick={onItemClick}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
                active
                  ? 'bg-violet-100/90 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 shadow-sm'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80'
              )}
            >
              <IconBadge icon={Icon} variant={variant} size="sm" rounded="lg" />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function TopTieringSidebar({
  sidebarOpen,
  onSidebarOpenChange,
  sidebarCollapsed,
  onSidebarCollapsedChange,
  className,
}: TopTieringSidebarProps) {
  const isMobile = useIsMobile();
  const location = useLocation();
  const collapsed = sidebarCollapsed ?? false;
  const onCollapsed = onSidebarCollapsedChange ?? (() => {});

  const closeSheet = () => onSidebarOpenChange(false);
  const sidebarBody = (
    <SidebarNav
      onItemClick={closeSheet}
      onToggleCollapse={!isMobile && !collapsed ? () => onCollapsed(true) : undefined}
      pathname={location.pathname}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={sidebarOpen} onOpenChange={onSidebarOpenChange}>
        <SheetContent side="left" className="w-[280px] p-0 flex flex-col border-r border-slate-200/70 dark:border-slate-700/50">
          <SheetHeader className="px-4 py-3.5 border-b border-slate-200/70 dark:border-slate-700/50">
            <SheetTitle className="text-base font-semibold flex items-center gap-2">
              <IconBadge icon={Filter} variant="amber" size="sm" rounded="lg" />
              Top Tiering
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
