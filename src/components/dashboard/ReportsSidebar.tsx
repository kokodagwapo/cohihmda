import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Zap, BarChart3, Target, Trophy, X, Sun, FileText, LayoutGrid, TrendingUp, LayoutDashboard, Filter, ArrowLeftRight, Shield, ClipboardList, Calculator, LineChart, Pin, PinOff, FlaskConical, GripVertical, Lock, Layers, Mail, Users, MessageSquare, LayoutPanelLeft, Database } from 'lucide-react';
import { getReportById, ReportData, allReports } from '@/data/reportSimulations';
import { useTheme } from '@/components/theme-provider';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { usePinnedDashboardsStore, type PinnedItem } from '@/stores/pinnedDashboardsStore';
import { useTenantStore } from '@/stores/tenantStore';
import { useTenantLosLastSyncedAt } from '@/hooks/useTenantLosLastSyncedAt';
import { formatDataLastSyncedLine } from '@/utils/losSyncDisplay';
import { useWorkbenchNav, type SidebarCanvas } from '@/hooks/useWorkbenchNav';
import { UnifiedChatSidebarSections } from '@/components/cohi/UnifiedChatSidebarSections';
import { UnifiedSidebarInsightsNav } from '@/components/cohi/UnifiedSidebarInsightsNav';
import { isUnifiedChatClientEnabled } from '@/lib/unifiedChatEnvelope';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface DashboardVisibility {
  executiveDashboard: boolean;
  industryNews: boolean;
  CohiInsights: boolean;
  leaderboard: boolean;
  topTiering: boolean;
  closingFalloutForecast: boolean;
  trends: boolean;
  forecasting: boolean;
  kpiReports: boolean;
  financialModeling: boolean;
  myWorkbench: boolean;
}

export type SectionId = keyof DashboardVisibility;

interface ReportsSidebarProps {
  onReportClick: (report: ReportData) => void;
  visibility?: DashboardVisibility;
  onVisibilityChange?: (visibility: DashboardVisibility) => void;
  sectionOrder?: SectionId[];
  onSectionOrderChange?: (order: SectionId[]) => void;
  mobileMenuOpen?: boolean;
  onMobileMenuToggle?: () => void;
  onSectionClick?: (sectionId: string) => void;
  /** Visitor's first name for "Welcome {firstName}" in the sidebar header. */
  visitorFirstName?: string | null;
}

// Complete realtime data for each report
interface ReportStats {
  primary: { value: string; label: string };
  secondary: { value: string; label: string };
  tertiary?: { value: string; label: string };
  trend: 'up' | 'down' | 'neutral';
  alert: boolean;
  alertMessage?: string;
}

const useRealtimeStats = () => {
  const [stats, setStats] = useState<Record<string, ReportStats>>({
    '1': { 
      primary: { value: '$1.28M', label: 'locked today' },
      secondary: { value: '42', label: 'loans' },
      tertiary: { value: '+8%', label: 'vs yesterday' },
      trend: 'up',
      alert: false 
    },
    '2': { 
      primary: { value: '3', label: 'loans at risk' },
      secondary: { value: '$892K', label: 'exposure' },
      tertiary: { value: '48hrs', label: 'to action' },
      trend: 'up',
      alert: true,
      alertMessage: 'FHA rate locks expiring'
    },
    '3': { 
      primary: { value: '65%', label: 'top tier revenue' },
      secondary: { value: '18', label: 'top performers' },
      tertiary: { value: '3', label: 'need coaching' },
      trend: 'up',
      alert: false 
    },
    '4': { 
      primary: { value: '2.1d', label: 'behind SLA' },
      secondary: { value: '8', label: 'files aging' },
      tertiary: { value: '2', label: 'processors overloaded' },
      trend: 'down',
      alert: true,
      alertMessage: 'Bottleneck in underwriting'
    },
    '5': { 
      primary: { value: '+12bps', label: 'vs market' },
      secondary: { value: '87', label: 'rate score' },
      tertiary: { value: 'Strong', label: 'position' },
      trend: 'up',
      alert: false 
    },
    '6': { 
      primary: { value: '$18.2K', label: 'margin/loan' },
      secondary: { value: '$1.85M', label: 'gross MTD' },
      tertiary: { value: '+14%', label: 'vs target' },
      trend: 'up',
      alert: false 
    },
  });

  useEffect(() => {
    // Simulate realtime updates every 30 seconds
    const interval = setInterval(() => {
      setStats(prev => ({
        ...prev,
        '1': { 
          ...prev['1'], 
          primary: { value: `$${(1.2 + Math.random() * 0.2).toFixed(2)}M`, label: 'locked today' },
          secondary: { value: String(Math.floor(38 + Math.random() * 8)), label: 'loans' },
        },
        '2': { 
          ...prev['2'], 
          primary: { value: String(Math.floor(2 + Math.random() * 4)), label: 'loans at risk' },
          alert: Math.random() > 0.4,
        },
        '4': { 
          ...prev['4'], 
          primary: { value: `${(1.8 + Math.random() * 0.8).toFixed(1)}d`, label: 'behind SLA' },
          secondary: { value: String(Math.floor(6 + Math.random() * 5)), label: 'files aging' },
        },
      }));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  return stats;
};

// Executive-focused report configuration
const reportConfig: Record<string, { label: string; question: string }> = {
  'Daily Production Pulse': { label: 'Production', question: 'Are we winning today?' },
  'Fallout and Risk': { label: 'Risk Alert', question: 'What needs attention?' },
  'Loan Officer Top Tiering Performance': { label: 'LO Performance', question: 'Who needs coaching?' },
  'Operations and Speed': { label: 'Operations', question: 'Where are bottlenecks?' },
  'Rate Competitiveness': { label: 'Market Position', question: 'Are we priced right?' },
  'Profitability Snapshot': { label: 'Profitability', question: 'Are we making money?' }
};

const statusConfig = {
  healthy: {
    dot: 'bg-emerald-500',
    bg: 'hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  warning: {
    dot: 'bg-amber-500',
    bg: 'hover:bg-amber-50/50 dark:hover:bg-amber-950/20',
    text: 'text-amber-600 dark:text-amber-400',
  },
  critical: {
    dot: 'bg-rose-500',
    bg: 'hover:bg-rose-50/50 dark:hover:bg-rose-950/20',
    text: 'text-rose-600 dark:text-rose-400',
  }
};

// Dashboard section configuration
const dashboardSectionsConfig = [
  { id: 'CohiInsights' as SectionId, label: 'Cohi Insights', icon: Sun, color: 'text-emerald-500', section: 'main' },
  { id: 'industryNews' as SectionId, label: 'Cohi Mortgage News', icon: FileText, color: 'text-blue-500', section: 'main' },
  { id: 'leaderboard' as SectionId, label: 'Leaderboard', icon: Trophy, color: 'text-amber-500', section: 'dashboards' },
  { id: 'executiveDashboard' as SectionId, label: 'Business Overview', icon: Target, color: 'text-blue-500', section: 'dashboards' },
];

// Default section order - matches actual display order on /insights page
export const defaultSectionOrder: SectionId[] = [
  'CohiInsights',
  'industryNews',
  'leaderboard',
  'executiveDashboard',
];

// Nav menu structure mirroring top Navigation (keep sidemenu icons: Sun, FileText, Trophy, Target, BarChart3 for sections)
const INSIGHTS_CHILDREN = [
  { type: 'section' as const, id: 'CohiInsights' as SectionId, label: 'Cohi Insights', icon: Sun, color: 'text-emerald-500' },
  { type: 'section' as const, id: 'industryNews' as SectionId, label: 'Cohi Mortgage News', icon: FileText, color: 'text-blue-500' },
];

// Dashboard floating menu items (Leaderboard, Business Overview, Closing & Fallout Forecast)
const DASHBOARD_FLOATING_ITEMS: { id: SectionId; label: string; icon: typeof Trophy; color: string }[] = [
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy, color: 'text-amber-500' },
  { id: 'executiveDashboard', label: 'Business Overview', icon: Target, color: 'text-blue-500' },
];

type SubsectionKey = 'dashboard' | 'topTiering' | 'sales' | 'operations' | 'financialModeling';

const DASHBOARD_CHILDREN = [
  { type: 'subheader' as const, label: 'Dashboard', subsectionKey: 'dashboard' as SubsectionKey },
  { type: 'section' as const, id: 'leaderboard' as SectionId, label: 'Leaderboard', icon: Trophy, color: 'text-amber-500', subsectionKey: 'dashboard' as SubsectionKey },
  { type: 'section' as const, id: 'executiveDashboard' as SectionId, label: 'Business Overview', icon: Target, color: 'text-blue-500', subsectionKey: 'dashboard' as SubsectionKey },
];

// Submenus under Toptiering main menu (Core Analytics, Sales, Operations, Financial Modeling)
const TOPTIERING_CHILDREN = [
  { type: 'subheader' as const, label: 'Core Analytics', subsectionKey: 'topTiering' as SubsectionKey },
  // Loan Funnel page hidden â€“ references removed
  // { type: 'route' as const, id: 'loanFunnel', label: 'Loan Funnel', icon: Filter, path: '/loan-funnel', subsectionKey: 'topTiering' as SubsectionKey },
  { type: 'route' as const, id: 'topTieringComparison', label: 'TopTiering Comparison', icon: ArrowLeftRight, path: '/performance/toptiering-comparison', subsectionKey: 'topTiering' as SubsectionKey },
  { type: 'route' as const, id: 'creditRiskManagement', label: 'Credit Risk Management', icon: Shield, path: '/credit-risk-management', subsectionKey: 'topTiering' as SubsectionKey },
  { type: 'route' as const, id: 'companyScorecard', label: 'Company Scorecard', icon: ClipboardList, path: '/company-scorecard', subsectionKey: 'topTiering' as SubsectionKey },
  { type: 'route' as const, id: 'lockStratification', label: 'Lock Stratification', icon: Lock, path: '/lock-stratification', subsectionKey: 'topTiering' as SubsectionKey },
  { type: 'route' as const, id: 'loanComplexity', label: 'Loan Complexity', icon: Layers, path: '/loan-complexity', subsectionKey: 'topTiering' as SubsectionKey },
  { type: 'route' as const, id: 'falloutForecastPage', label: 'Fallout Report', icon: BarChart3, path: '/fallout-forecast', subsectionKey: 'topTiering' as SubsectionKey },
  { type: 'subheader' as const, label: 'Sales', subsectionKey: 'sales' as SubsectionKey },
  { type: 'route' as const, id: 'salesScorecard', label: 'Scorecard', icon: Target, path: '/sales-scorecard', subsectionKey: 'sales' as SubsectionKey },
  { type: 'route' as const, id: 'salesTrends', label: 'Trends', icon: TrendingUp, path: '/sales-trends', subsectionKey: 'sales' as SubsectionKey },
  { type: 'route' as const, id: 'productionTrends', label: 'Production Trends', icon: LineChart, path: '/production-trends', subsectionKey: 'sales' as SubsectionKey },
  { type: 'route' as const, id: 'productionSummaryByWeek', label: 'Production Summary by Week', icon: LineChart, path: '/production-summary-by-week', subsectionKey: 'sales' as SubsectionKey },
  { type: 'subheader' as const, label: 'Operations', subsectionKey: 'operations' as SubsectionKey },
  { type: 'route' as const, id: 'operationsScorecard', label: 'Scorecard', icon: Target, path: '/performance/operation-scorecard', subsectionKey: 'operations' as SubsectionKey },
  { type: 'route' as const, id: 'operationsTrends', label: 'Trends', icon: LineChart, path: '/performance/operation-scorecard-trends', subsectionKey: 'operations' as SubsectionKey },
  { type: 'route' as const, id: 'estimatedClosingsRisk', label: 'Estimated Closings and Risk Analysis', icon: BarChart3, path: '/performance/estimated-closings-risk', subsectionKey: 'operations' as SubsectionKey },
  { type: 'route' as const, id: 'activeWorkload', label: 'Active Workload', icon: BarChart3, path: '/performance/active-workload', subsectionKey: 'operations' as SubsectionKey },
  { type: 'subheader' as const, label: 'Financial Modeling', subsectionKey: 'financialModeling' as SubsectionKey },
  { type: 'route' as const, id: 'financialModeling', label: 'Financial Modeling Sandbox', icon: Calculator, path: '/performance/financial-modeling-sandbox', subsectionKey: 'financialModeling' as SubsectionKey },
  { type: 'subheader' as const, label: 'Data', subsectionKey: 'operations' as SubsectionKey },
  { type: 'route' as const, id: 'dataQuality', label: 'Data Quality', icon: Database, path: '/data-quality', subsectionKey: 'operations' as SubsectionKey },
];

type ToptieringRouteItem = Extract<(typeof TOPTIERING_CHILDREN)[number], { type: 'route' }>;
const TOPTIERING_GROUPS: Array<{ key: SubsectionKey; label: string; items: ToptieringRouteItem[] }> = [
  { key: 'topTiering', label: 'Core Analytics', items: TOPTIERING_CHILDREN.filter((it): it is ToptieringRouteItem => it.type === 'route' && it.subsectionKey === 'topTiering') },
  { key: 'sales', label: 'Sales', items: TOPTIERING_CHILDREN.filter((it): it is ToptieringRouteItem => it.type === 'route' && it.subsectionKey === 'sales') },
  { key: 'operations', label: 'Operations', items: TOPTIERING_CHILDREN.filter((it): it is ToptieringRouteItem => it.type === 'route' && it.subsectionKey === 'operations') },
  { key: 'financialModeling', label: 'Financial Modeling', items: TOPTIERING_CHILDREN.filter((it): it is ToptieringRouteItem => it.type === 'route' && it.subsectionKey === 'financialModeling') },
];

/** Hide TopTiering from sidebar; its routes are available under Dashboards and via pinning. */
const HIDE_TOPTIERING_IN_SIDEBAR = true;

export type PinnedItem =
  | { type: 'section'; id: SectionId }
  | { type: 'route'; id: string; path: string; label: string };
function getSectionLabel(id: string): string {
  const fromDash = DASHBOARD_CHILDREN.find((it) => it.type === 'section' && it.id === id);
  if (fromDash && fromDash.type === 'section') return fromDash.label;
  const fromInsights = INSIGHTS_CHILDREN.find((it) => it.type === 'section' && it.id === id);
  if (fromInsights && fromInsights.type === 'section') return fromInsights.label;
  return id;
}

// Icon style map matching top nav Dashboard submenu (Navigation.tsx)
const navIconStyleMap: Record<string, { bg: string; icon: string }> = {
  amber: { bg: 'bg-amber-500/10 dark:bg-amber-500/20', icon: 'text-amber-500 dark:text-amber-400' },
  blue: { bg: 'bg-blue-500/10 dark:bg-blue-500/20', icon: 'text-blue-500 dark:text-blue-400' },
  indigo: { bg: 'bg-indigo-500/10 dark:bg-indigo-500/20', icon: 'text-indigo-500 dark:text-indigo-400' },
  emerald: { bg: 'bg-emerald-500/10 dark:bg-emerald-500/20', icon: 'text-emerald-500 dark:text-emerald-400' },
};

// Item id -> iconColor matching top nav Dashboard submenu
const navIconColorByItemId: Record<string, string> = {
  leaderboard: 'amber',
  executiveDashboard: 'blue',
  closingFalloutForecast: 'indigo',
  topTieringComparison: 'blue',
  creditRiskManagement: 'emerald',
  companyScorecard: 'indigo',
  lockStratification: 'blue',
  loanComplexity: 'indigo',
  falloutForecastPage: 'indigo',
  workflowConversion: 'blue',
  highPerformers: 'amber',
  loanDetail: 'blue',
  financialModeling: 'blue',
  salesScorecard: 'blue',
  salesTrends: 'emerald',
  productionTrends: 'emerald',
  productionSummaryByWeek: 'emerald',
  operationsScorecard: 'blue',
  operationsTrends: 'indigo',
  estimatedClosingsRisk: 'emerald',
  activeWorkload: 'blue',
  dataQuality: 'emerald',
};

function getIconAndColorForPinnedItem(item: PinnedItem): { Icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>; iconColor: string } {
  if (item.type === 'section') {
    const found = DASHBOARD_FLOATING_ITEMS.find((it) => it.id === item.id);
    const iconColor = navIconColorByItemId[item.id] ?? 'blue';
    return found ? { Icon: found.icon, iconColor } : { Icon: LayoutDashboard, iconColor: 'blue' };
  }
  const found = TOPTIERING_CHILDREN.find((it) => it.type === 'route' && it.id === item.id);
  const iconColor = navIconColorByItemId[item.id] ?? 'blue';
  return found && found.type === 'route' ? { Icon: found.icon, iconColor } : { Icon: LayoutDashboard, iconColor: 'blue' };
}

// Color mapping for section colors (used by Insights items)
const colorMap: Record<string, { bg: string; text: string }> = {
  'text-emerald-500': { bg: 'rgba(16, 185, 129, 0.1)', text: '#10b981' },
  'text-blue-500': { bg: 'rgba(59, 130, 246, 0.1)', text: '#3b82f6' },
  'text-amber-500': { bg: 'rgba(245, 158, 11, 0.1)', text: '#f59e0b' },
  'text-indigo-500': { bg: 'rgba(99, 102, 241, 0.1)', text: '#6366f1' },
  'text-violet-500': { bg: 'rgba(139, 92, 246, 0.1)', text: '#8b5cf6' },
  'text-slate-500': { bg: 'rgba(100, 116, 139, 0.1)', text: '#64748b' },
};

function getCanvasSidebarId(canvasId: string) {
  return `canvas-${canvasId}`;
}

interface SortableSidebarDashboardRowProps {
  id: string;
  isDarkMode: boolean;
  isCurrent: boolean;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  style: { bg: string; icon: string };
  onNavigate: () => void;
  onRemove: () => void;
  removeTitle?: string;
}

function SortableSidebarDashboardRow({
  id,
  isDarkMode,
  isCurrent,
  label,
  Icon,
  style,
  onNavigate,
  onRemove,
  removeTitle = 'Unpin from sidebar',
}: SortableSidebarDashboardRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const styleTransform = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={styleTransform}
      className={cn(
        'flex items-center gap-1 group rounded-lg',
        isDarkMode ? 'hover:bg-slate-700/50' : 'hover:bg-slate-100',
        isCurrent && (isDarkMode ? 'bg-slate-700/40' : 'bg-slate-100'),
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="shrink-0 p-1 rounded cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 hover:bg-slate-200/60 dark:hover:bg-slate-600/60 touch-none"
        title="Drag to reorder"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
      </div>
      <button
        type="button"
        onClick={onNavigate}
        style={{
          flex: 1,
          padding: '12px 12px 12px 8px',
          background: 'transparent',
          border: 'none',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          transition: 'all 0.2s ease',
          minWidth: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
        className="rounded-lg"
      >
        <div
          className={cn(
            'flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center',
            style.bg,
            isCurrent && 'ring-1 ring-emerald-400/50',
          )}
        >
          <Icon className={cn('w-4 h-4', isCurrent ? 'text-emerald-500 dark:text-emerald-400' : style.icon)} />
        </div>
        <span
          style={{ fontSize: 13, fontWeight: 500, color: isDarkMode ? '#e2e8f0' : '#1a1d29', flex: 1 }}
          className="truncate"
        >
          {label}
        </span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="shrink-0 p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-slate-200/60 dark:hover:bg-slate-600/60 mr-2"
        title={removeTitle}
        aria-label="Unpin"
      >
        <PinOff className="w-3.5 h-3.5 text-amber-500" />
      </button>
    </div>
  );
}

interface SortablePinnedItemProps {
  id: string;
  item: PinnedItem;
  isDarkMode: boolean;
  isCurrent: boolean;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  style: { bg: string; icon: string };
  onNavigate: () => void;
  onRemove: () => void;
  onSectionClick?: (sectionId: string) => void;
}

function SortablePinnedItem(props: SortablePinnedItemProps) {
  const { id, item, isDarkMode, isCurrent, label, Icon, style, onNavigate, onRemove, onSectionClick } =
    props;
  return (
    <SortableSidebarDashboardRow
      id={id}
      isDarkMode={isDarkMode}
      isCurrent={isCurrent}
      label={label}
      Icon={Icon}
      style={style}
      onNavigate={() =>
        item.type === 'section' ? onSectionClick?.(item.id) : onNavigate()
      }
      onRemove={onRemove}
    />
  );
}

const workbenchCanvasNavStyle = {
  bg: 'bg-violet-500/10 dark:bg-violet-500/20',
  icon: 'text-violet-500 dark:text-violet-400',
};

function WorkbenchCanvasSidebarRow({
  canvas,
  isDarkMode,
  isCurrent,
  onNavigate,
  onUnpin,
  variant = 'desktop',
}: {
  canvas: SidebarCanvas;
  isDarkMode: boolean;
  isCurrent: boolean;
  onNavigate: () => void;
  onUnpin: () => void;
  variant?: 'desktop' | 'mobile' | 'popover';
}) {
  if (variant === 'desktop') {
    return (
      <SortableSidebarDashboardRow
        id={getCanvasSidebarId(canvas.id)}
        isDarkMode={isDarkMode}
        isCurrent={isCurrent}
        label={canvas.title}
        Icon={LayoutPanelLeft}
        style={workbenchCanvasNavStyle}
        onNavigate={onNavigate}
        onRemove={onUnpin}
        removeTitle="Remove from My Dashboards"
      />
    );
  }

  if (variant === 'mobile') {
    return (
      <div className="flex items-center gap-2 p-2.5 min-h-[44px] rounded-lg hover:bg-slate-100/80 dark:hover:bg-slate-800/80 touch-manipulation">
        <button
          type="button"
          onClick={onNavigate}
          className={cn(
            'flex-shrink-0 min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center',
            workbenchCanvasNavStyle.bg,
            isCurrent && 'ring-1 ring-emerald-400/50',
          )}
        >
          <LayoutPanelLeft
            className={cn(
              'w-4 h-4',
              isCurrent ? 'text-emerald-600 dark:text-emerald-400' : workbenchCanvasNavStyle.icon,
            )}
          />
        </button>
        <button
          type="button"
          onClick={onNavigate}
          className={cn(
            'flex-1 text-left text-sm min-h-[44px] flex items-center truncate',
            isCurrent
              ? 'text-slate-900 dark:text-slate-100 font-medium'
              : 'text-slate-700 dark:text-slate-300',
          )}
        >
          {canvas.title}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUnpin();
          }}
          className="shrink-0 p-1.5 rounded hover:bg-slate-200/60 dark:hover:bg-slate-600/60"
          title="Remove from My Dashboards"
          aria-label="Unpin"
        >
          <PinOff className="w-3.5 h-3.5 text-amber-500" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 group rounded-md">
      <button
        type="button"
        onClick={onNavigate}
        className={cn(
          'flex-1 flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800/60 min-w-0',
          isCurrent && 'bg-slate-100 dark:bg-slate-800/40',
        )}
      >
        <div
          className={cn(
            'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center',
            workbenchCanvasNavStyle.bg,
            isCurrent && 'ring-1 ring-emerald-400/50',
          )}
        >
          <LayoutPanelLeft
            className={cn(
              'w-4 h-4',
              isCurrent ? 'text-emerald-500 dark:text-emerald-400' : workbenchCanvasNavStyle.icon,
            )}
          />
        </div>
        <span className="truncate">{canvas.title}</span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onUnpin();
        }}
        className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-slate-200/60 dark:hover:bg-slate-600/60"
        title="Remove from My Dashboards"
        aria-label="Unpin"
      >
        <PinOff className="w-3.5 h-3.5 text-amber-500" />
      </button>
    </div>
  );
}

const EMPTY_MY_DASHBOARDS_HINT =
  'Pin dashboards from the top nav, or favorite workbench canvases to see them here.';

export const ReportsSidebar: React.FC<ReportsSidebarProps> = ({ 
  onReportClick, 
  visibility, 
  onVisibilityChange,
  sectionOrder: externalOrder,
  onSectionOrderChange,
  mobileMenuOpen: externalMobileOpen,
  onMobileMenuToggle,
  onSectionClick,
  visitorFirstName
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, isMobile } = useSidebar();
  const { theme } = useTheme();
  const isDarkMode = theme === 'dark';
  const isExpanded = state !== 'collapsed';
  const selectedTenantId = useTenantStore((s) => s.selectedTenantId);
  const { lastSyncedAt: losLastSyncedAt } =
    useTenantLosLastSyncedAt(selectedTenantId);
  const isInsightsPage = location.pathname === '/insights';
  const isDashboardPage = isInsightsPage; // dashboard content moved to /insights
  const [internalMobileOpen, setInternalMobileOpen] = useState(false);
  const [insightsFlyoutOpen, setInsightsFlyoutOpen] = useState(false);
  const [pinnedDashboardFlyoutOpen, setPinnedDashboardFlyoutOpen] = useState(false);
  const [toptieringFlyoutOpen, setToptieringFlyoutOpen] = useState(false);
  const flyoutLeaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMobileOpen = externalMobileOpen !== undefined ? externalMobileOpen : internalMobileOpen;
  const [insightsExpanded, setInsightsExpanded] = useState(true);
  const unifiedChatIa = isUnifiedChatClientEnabled();
  const [dashboardsExpanded, setDashboardsExpanded] = useState(() => !unifiedChatIa);
  const [researchExpanded, setResearchExpanded] = useState(true);
  const [toptieringExpanded, setToptieringExpanded] = useState(false);
  const [topTieringSubExpanded, setTopTieringSubExpanded] = useState(true);
  const [salesSubExpanded, setSalesSubExpanded] = useState(true);
  const [operationsSubExpanded, setOperationsSubExpanded] = useState(true);
  const [financialModelingSubExpanded, setFinancialModelingSubExpanded] = useState(true);
  const { pinned: pinnedItems, removePinned, reorderPinned, getPinnedItemId } = usePinnedDashboardsStore();
  const { favoriteCanvases, toggleCanvasFavorite } = useWorkbenchNav();
  const pinnedIds = useMemo(() => pinnedItems.map((p) => getPinnedItemId(p)), [pinnedItems, getPinnedItemId]);
  const favoriteCanvasSidebarIds = useMemo(
    () => favoriteCanvases.map((c) => getCanvasSidebarId(c.id)),
    [favoriteCanvases],
  );
  const myDashboardsSortableIds = useMemo(
    () => [...pinnedIds, ...favoriteCanvasSidebarIds],
    [pinnedIds, favoriteCanvasSidebarIds],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const handleMyDashboardsDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = myDashboardsSortableIds.indexOf(String(active.id));
    const newIndex = myDashboardsSortableIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(myDashboardsSortableIds, oldIndex, newIndex);
    const pinnedOnly = reordered.filter((id) => pinnedIds.includes(id));
    if (pinnedOnly.length === pinnedIds.length) reorderPinned(pinnedOnly);
  };
  const realtimeStats = useRealtimeStats();

  const subExpanded: Record<SubsectionKey, boolean> = {
    dashboard: true,
    topTiering: topTieringSubExpanded,
    sales: salesSubExpanded,
    operations: operationsSubExpanded,
    financialModeling: financialModelingSubExpanded,
  };
  const setSubExpanded = (k: SubsectionKey, v: boolean) => {
    if (k === 'topTiering') setTopTieringSubExpanded(v);
    else if (k === 'sales') setSalesSubExpanded(v);
    else if (k === 'operations') setOperationsSubExpanded(v);
    else if (k === 'financialModeling') setFinancialModelingSubExpanded(v);
  };

  // Default visibility state
  const defaultVisibility: DashboardVisibility = {
    executiveDashboard: false,
    industryNews: true,
    CohiInsights: true,
    leaderboard: true,
    topTiering: true,
    closingFalloutForecast: false,
    trends: false,
    forecasting: false,
    kpiReports: false,
    financialModeling: true,
    myWorkbench: true,
  };

  const currentVisibility = visibility || defaultVisibility;

  // Count active sections - only count sections that are in dashboardSectionsConfig
  const activeCount = dashboardSectionsConfig.filter(section => currentVisibility[section.id]).length;

  const { setOpenMobile } = useSidebar();

  const handleToggleSection = (sectionId: keyof DashboardVisibility) => {
    if (onVisibilityChange) {
      onVisibilityChange({
        ...currentVisibility,
        [sectionId]: !currentVisibility[sectionId],
      });
    }
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const toggleMobile = () => {
    if (onMobileMenuToggle) {
      onMobileMenuToggle();
    } else {
      setInternalMobileOpen(!internalMobileOpen);
    }
  };

  const isPathActive = (path: string) => {
    if (path.includes('?')) {
      const [pathname, search] = path.split('?');
      return location.pathname === pathname && location.search.includes(search);
    }
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const getSectionElementId = (sectionId: string): string => {
    const sectionIdMap: Record<string, string> = {
      CohiInsights: 'CohiInsights',
      industryNews: 'industryNews',
      leaderboard: 'leaderboard',
      executiveDashboard: 'executiveDashboard',
      closingFalloutForecast: 'closingFalloutForecast',
    };
    return sectionIdMap[sectionId] || `section-${sectionId}`;
  };

  const scrollToElementWithHeaderOffset = (elementId: string) => {
    const element = document.getElementById(elementId);
    if (!element) return false;

    const headerOffset = 80;
    const elementPosition = element.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth',
    });
    return true;
  };

  const handleSectionNavigation = (sectionId: string) => {
    const elementId = getSectionElementId(sectionId);

    if (location.pathname !== '/insights') {
      navigate('/insights');
      setTimeout(() => {
        const scrollToElement = () => {
          if (!scrollToElementWithHeaderOffset(elementId)) {
            setTimeout(scrollToElement, 100);
          }
        };
        scrollToElement();
      }, 300);
      return;
    }

    if (onSectionClick) {
      onSectionClick(sectionId);
      return;
    }

    scrollToElementWithHeaderOffset(elementId);
  };


  const handleButtonClick = (reportId: string) => {
    const report = getReportById(reportId);
    if (report) {
      onReportClick(report);
    }
  };


  // Check if any report has an alert
  const hasActiveAlerts = Object.values(realtimeStats).some(s => s.alert);
  const alertCount = Object.values(realtimeStats).filter(s => s.alert).length;

  return (
    <>
      {/* Mobile: Top slide-down panel */}
      <AnimatePresence>
        {isMobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={toggleMobile}
              className="md:hidden fixed inset-0 bg-black/50 z-40"
            />
            <motion.div
              initial={{ y: '-100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '-100%', opacity: 0 }}
              transition={{ type: 'tween', duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              className="md:hidden fixed top-14 sm:top-16 left-0 right-0 z-50 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 shadow-2xl max-h-[calc(100dvh-3.5rem)] sm:max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain"
              style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}
            >
              <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center justify-between z-10">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-emerald-500" />
                  <p className="text-sm font-thin text-slate-800 dark:text-slate-200 tracking-tight">
                    {isInsightsPage ? 'Sections' : 'Choose Sections'}
                  </p>
                  <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full text-[10px] font-thin text-slate-600 dark:text-slate-400">
                    {isInsightsPage
                      ? `${[currentVisibility.CohiInsights, currentVisibility.industryNews].filter(Boolean).length} of 2`
                      : `${activeCount} of ${dashboardSectionsConfig.length}`}
                  </span>
                </div>
                <button
                  onClick={toggleMobile}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
                  aria-label="Close menu"
                >
                  <X className="w-5 h-5" strokeWidth={2} />
                </button>
              </div>

              <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 md:hidden">
                <p
                  className="text-sm text-slate-500 dark:text-slate-400 leading-snug"
                  title={
                    losLastSyncedAt
                      ? new Date(losLastSyncedAt).toLocaleString(undefined, {
                          dateStyle: 'full',
                          timeStyle: 'medium',
                        })
                      : undefined
                  }
                >
                  {formatDataLastSyncedLine(losLastSyncedAt)}
                </p>
              </div>
              
              {isInsightsPage ? (
                /* /insights mobile: only Cohi Insights + Cohi Mortgage News */
                <div className="p-4 pt-3 space-y-0">
                  {INSIGHTS_CHILDREN.map((it) => {
                    if (it.type !== 'section') return null;
                    const Icon = it.icon;
                    const isActive = currentVisibility[it.id];
                    return (
                      <div
                        key={it.id}
                        className="flex items-center gap-3 px-3 py-3 min-h-[52px] rounded-xl hover:bg-slate-100/80 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <div
                          className={cn(
                            'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
                            it.id === 'CohiInsights'
                              ? 'bg-emerald-500/10 dark:bg-emerald-500/20'
                              : 'bg-blue-500/10 dark:bg-blue-500/20'
                          )}
                        >
                          <Icon
                            className={cn(
                              'w-5 h-5',
                              it.id === 'CohiInsights'
                                ? 'text-emerald-500 dark:text-emerald-400'
                                : 'text-blue-500 dark:text-blue-400'
                            )}
                          />
                        </div>
                        <button
                          onClick={() => { handleSectionNavigation(it.id); onMobileMenuToggle?.(); }}
                          className="flex-1 text-left text-sm font-medium text-slate-800 dark:text-slate-200 min-h-[44px] flex items-center"
                        >
                          {it.label}
                        </button>
                        <button
                          onClick={() => handleToggleSection(it.id)}
                          className={cn(
                            'flex-shrink-0 w-10 h-6 rounded-full flex items-center transition-colors min-h-[44px]',
                            isActive ? 'bg-emerald-500 justify-end pr-1' : 'bg-slate-300 dark:bg-slate-600 justify-start pl-1'
                          )}
                        >
                          <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
              <>
              {/* Quick Actions - toggles for the 5 Insights sections */}
              <div className="px-4 pt-3 pb-2 flex items-center gap-2">
                <button
                  onClick={() => {
                    const allVisible = activeCount === dashboardSectionsConfig.length;
                    if (onVisibilityChange) {
                      const newVisibility: DashboardVisibility = { ...currentVisibility };
                      dashboardSectionsConfig.forEach(section => {
                        newVisibility[section.id] = !allVisible;
                      });
                      onVisibilityChange(newVisibility);
                    }
                  }}
                  className="flex-1 px-3 py-2 text-xs font-thin rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  {activeCount === dashboardSectionsConfig.length ? 'Hide All' : 'Show All'}
                </button>
              </div>
              
              <div className="p-4 pt-2 space-y-1">
                {/* Insights â€” Â§6.1 single control when unified */}
                {unifiedChatIa ? (
                  <button
                    type="button"
                    onClick={() => { navigate('/insights'); onMobileMenuToggle?.(); }}
                    className="w-full flex items-center gap-3 p-3 min-h-[44px] rounded-xl hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-all touch-manipulation"
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-500/10 dark:bg-emerald-500/20">
                      <Sun className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 flex-1 text-left">Insights</p>
                  </button>
                ) : (
                <div>
                  <button
                    onClick={() => setInsightsExpanded(!insightsExpanded)}
                    className="w-full flex items-center gap-3 p-3 min-h-[44px] rounded-xl hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-all touch-manipulation"
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-slate-50 dark:bg-slate-800/30">
                      <TrendingUp className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 flex-1 text-left">Insights</p>
                    <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform duration-200", !insightsExpanded && "-rotate-90")} />
                  </button>
                  <AnimatePresence initial={false}>
                    {insightsExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        className="overflow-hidden"
                      >
                        <div className="pl-4 pr-2 pb-2 space-y-1">
                      {INSIGHTS_CHILDREN.map((it) => {
                        if (it.type !== 'section') return null;
                        const Icon = it.icon;
                        const isActive = currentVisibility[it.id];
                        return (
                          <div key={it.id} className="flex items-center gap-2 p-2.5 min-h-[44px] rounded-lg hover:bg-slate-100/80 dark:hover:bg-slate-800/80 touch-manipulation">
                            <button onClick={() => handleToggleSection(it.id)} className="relative flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center">
                              <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", isActive ? "bg-slate-100 dark:bg-slate-800/60" : "bg-slate-50 dark:bg-slate-800/30")}>
                                <Icon className={cn("w-4 h-4", isActive ? it.color : "text-slate-400 dark:text-slate-500")} />
                              </div>
                              {isActive && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500" />}
                            </button>
                            <button
                              onClick={() => { handleSectionNavigation(it.id); onMobileMenuToggle?.(); }}
                              className="flex-1 text-left text-sm text-slate-700 dark:text-slate-300 min-h-[44px] flex items-center"
                            >
                              {it.label}
                            </button>
                            <button
                              onClick={() => handleToggleSection(it.id)}
                              className={cn("w-8 h-5 min-w-[44px] min-h-[44px] rounded-full flex items-center transition-colors touch-manipulation", isActive ? "bg-emerald-500 justify-end" : "bg-slate-300 dark:bg-slate-600 justify-start")}
                            >
                              <div className="w-4 h-4 rounded-full bg-white shadow-sm mx-0.5" />
                            </button>
                          </div>
                        );
                      })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                )}

                {/* Dashboard - category always shown; submenu shows pinned items from top nav */}
                <div>
                  <button
                    type="button"
                    onClick={() => setDashboardsExpanded(!dashboardsExpanded)}
                    className="w-full flex items-center gap-3 px-4 pt-3 pb-2 min-h-[44px] rounded-xl hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-all touch-manipulation text-left"
                  >
                    <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-slate-100 dark:bg-slate-800/30">
                      <LayoutGrid className="w-[18px] h-[18px] text-slate-600 dark:text-slate-400" />
                    </div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex-1">My Dashboards</p>
                    <ChevronDown className={cn("w-[18px] h-[18px] text-slate-500 dark:text-slate-400 shrink-0 transition-transform duration-200", !dashboardsExpanded && "-rotate-90")} />
                  </button>
                  <AnimatePresence initial={false}>
                    {dashboardsExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                  <div className="pl-4 pr-2 pb-2 space-y-1">
                    {pinnedItems.length === 0 && favoriteCanvases.length === 0 ? (
                      <p className="px-2 py-2 text-xs text-slate-500 dark:text-slate-400">
                        {EMPTY_MY_DASHBOARDS_HINT}
                      </p>
                    ) : (
                      <>
                    {pinnedItems.map((item) => {
                      const { Icon, iconColor } = getIconAndColorForPinnedItem(item);
                      const style = navIconStyleMap[iconColor] ?? navIconStyleMap.blue;
                      if (item.type === 'section') {
                        const label = getSectionLabel(item.id);
                        return (
                          <div key={`section-${item.id}`} className="flex items-center gap-2 p-2.5 min-h-[44px] rounded-lg hover:bg-slate-100/80 dark:hover:bg-slate-800/80 touch-manipulation">
                            <button onClick={() => { handleSectionNavigation(item.id); onMobileMenuToggle?.(); }} className="relative flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center">
                              <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", style.bg)}>
                                <Icon className={cn("w-4 h-4", style.icon)} />
                              </div>
                            </button>
                            <button onClick={() => { handleSectionNavigation(item.id); onMobileMenuToggle?.(); }} className="flex-1 text-left text-sm text-slate-700 dark:text-slate-300 min-h-[44px] flex items-center">{label}</button>
                            <button onClick={(e) => { e.stopPropagation(); removePinned(item); }} className="shrink-0 p-1.5 rounded hover:bg-slate-200/60 dark:hover:bg-slate-600/60" title="Unpin"><PinOff className="w-3.5 h-3.5 text-amber-500" /></button>
                          </div>
                        );
                      }
                      const isCurrent = location.pathname === item.path;
                      return (
                        <div key={`route-${item.id}`} className="flex items-center gap-2 p-2.5 min-h-[44px] rounded-lg hover:bg-slate-100/80 dark:hover:bg-slate-800/80 touch-manipulation">
                          <button onClick={() => { navigate(item.path); onMobileMenuToggle?.(); }} className={cn("flex-shrink-0 min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center", style.bg, isCurrent && "ring-1 ring-emerald-400/50")}>
                            <Icon className={cn("w-4 h-4", isCurrent ? "text-emerald-600 dark:text-emerald-400" : style.icon)} />
                          </button>
                          <button onClick={() => { navigate(item.path); onMobileMenuToggle?.(); }} className="flex-1 text-left text-sm text-slate-700 dark:text-slate-300 min-h-[44px] flex items-center">{item.label}</button>
                          <button onClick={(e) => { e.stopPropagation(); removePinned(item); }} className="shrink-0 p-1.5 rounded hover:bg-slate-200/60 dark:hover:bg-slate-600/60" title="Unpin"><PinOff className="w-3.5 h-3.5 text-amber-500" /></button>
                        </div>
                      );
                    })}
                    {favoriteCanvases.map((canvas) => (
                      <WorkbenchCanvasSidebarRow
                        key={`canvas-${canvas.id}`}
                        canvas={canvas}
                        isDarkMode={isDarkMode}
                        isCurrent={location.pathname === `/my-dashboard/${canvas.id}`}
                        variant="mobile"
                        onNavigate={() => {
                          navigate(`/my-dashboard/${canvas.id}`);
                          onMobileMenuToggle?.();
                        }}
                        onUnpin={() => void toggleCanvasFavorite(canvas.id, false)}
                      />
                    ))}
                      </>
                    )}
                  </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {unifiedChatIa && (
                  <UnifiedChatSidebarSections
                    tenantId={selectedTenantId ?? undefined}
                    isDarkMode={isDarkMode}
                    isExpanded
                  />
                )}

                {/* Toptiering - hidden from sidebar; routes available under Dashboards and via pinning */}
                {!HIDE_TOPTIERING_IN_SIDEBAR && (
                <div>
                  <button
                    onClick={() => setToptieringExpanded(!toptieringExpanded)}
                    className="w-full flex items-center gap-3 p-3 min-h-[44px] rounded-xl hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-all touch-manipulation"
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-slate-50 dark:bg-slate-800/30">
                      <ArrowLeftRight className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 flex-1 text-left">TopTiering</p>
                    <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform duration-200", !toptieringExpanded && "-rotate-90")} />
                  </button>
                  <AnimatePresence initial={false}>
                    {toptieringExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        className="overflow-hidden"
                      >
                        <div className="pl-4 pr-2 pb-2 space-y-1">
                      {TOPTIERING_GROUPS.map((group) => {
                        const isExp = subExpanded[group.key];
                        return (
                          <div key={group.key}>
                            <button
                              type="button"
                              onClick={() => setSubExpanded(group.key, !isExp)}
                              className="w-full flex items-center gap-2 px-2 pt-2 pb-1 min-h-[44px] rounded-lg hover:bg-slate-100/80 dark:hover:bg-slate-800/80 text-left touch-manipulation"
                            >
                              <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex-1">{group.label}</p>
                              <ChevronDown className={cn("w-3.5 h-3.5 text-slate-400 flex-shrink-0 transition-transform duration-200", !isExp && "-rotate-90")} />
                            </button>
                            <AnimatePresence initial={false}>
                              {isExp && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                                  className="overflow-hidden"
                                >
                                  <div className="space-y-1">
                                    {group.items.map((it) => {
                                      const Icon = it.icon;
                                      const isCurrent = location.pathname === it.path;
                                      return (
                                        <button
                                          key={it.id}
                                          onClick={() => { navigate(it.path); onMobileMenuToggle?.(); }}
                                          className={cn("w-full flex items-center gap-2 p-2.5 min-h-[44px] rounded-lg hover:bg-slate-100/80 dark:hover:bg-slate-800/80 text-left touch-manipulation", isCurrent && "bg-slate-100 dark:bg-slate-800/60")}
                                        >
                                          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", isCurrent ? "bg-slate-100 dark:bg-slate-800/60" : "bg-slate-50 dark:bg-slate-800/30")}>
                                            <Icon className={cn("w-4 h-4", isCurrent ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400")} />
                                          </div>
                                          <span className={cn("text-sm", isCurrent ? "text-slate-900 dark:text-slate-100 font-medium" : "text-slate-700 dark:text-slate-300")}>{it.label}</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                )}

                {!unifiedChatIa && (
                <div>
                  <button
                    type="button"
                    onClick={() => setResearchExpanded(!researchExpanded)}
                    className="w-full flex items-center gap-2 p-2.5 min-h-[44px] rounded-lg hover:bg-slate-100/80 dark:hover:bg-slate-800/80 touch-manipulation text-left"
                  >
                    <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", isPathActive('/research') ? "bg-slate-100 dark:bg-slate-800/60" : "bg-slate-50 dark:bg-slate-800/30")}>
                      <FlaskConical className={cn("w-4 h-4", isPathActive('/research') ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400")} />
                    </div>
                    <span className={cn("text-sm flex-1", isPathActive('/research') ? "text-slate-900 dark:text-slate-100 font-medium" : "text-slate-700 dark:text-slate-300")}>Research Lab</span>
                    <ChevronDown className={cn("w-[18px] h-[18px] text-slate-500 dark:text-slate-400 shrink-0 transition-transform duration-200", !researchExpanded && "-rotate-90")} />
                  </button>
                  <AnimatePresence initial={false}>
                    {researchExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <div className="pl-4 pr-2 pb-2">
                          <button
                            type="button"
                            onClick={() => { navigate('/research'); onMobileMenuToggle?.(); }}
                            className={cn("w-full text-left text-sm px-2 py-2 rounded-lg hover:bg-slate-100/80 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-300", isPathActive('/research') && "font-medium text-slate-900 dark:text-slate-100")}
                          >
                            Open Research Lab
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                )}

                {!unifiedChatIa && (
                <div className={cn("flex items-center gap-2 p-2.5 min-h-[44px] rounded-lg hover:bg-slate-100/80 dark:hover:bg-slate-800/80 touch-manipulation", isPathActive('/workbench/distributions') && "bg-slate-100 dark:bg-slate-800/60")}>
                  <button onClick={() => { navigate('/workbench/distributions'); onMobileMenuToggle?.(); }} className="relative flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center">
                    <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", isPathActive('/workbench/distributions') ? "bg-slate-100 dark:bg-slate-800/60" : "bg-slate-50 dark:bg-slate-800/30")}>
                      <Mail className={cn("w-4 h-4", isPathActive('/workbench/distributions') ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400")} />
                    </div>
                  </button>
                  <button onClick={() => { navigate('/workbench/distributions'); onMobileMenuToggle?.(); }} className="flex-1 text-left text-sm text-slate-700 dark:text-slate-300 min-h-[44px] flex items-center">Communications Center</button>
                </div>
                )}
              </div>
              </>
              )}
              <div className="px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
                <p className="text-xs font-thin text-slate-500 dark:text-slate-400 text-center">
                  Toggle to show/hide sections
                </p>
              </div>
              <div className="h-1 bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500 opacity-60" />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Desktop: same behavior/styles as /admin-v2 â€” fixed, scrollable content, header with expand/collapse */}
      <Sidebar
        variant="inset"
        collapsible="icon"
        className={cn(
          "top-16 h-[calc(100vh-4rem)] p-0 z-30",
          // Match main Navigation bar: frosted slate glass + same border/shadow language
          "border-r border-slate-200/50 bg-white/80 backdrop-blur-xl dark:border-slate-800/50 dark:bg-slate-950/70",
          "shadow-[0_8px_32px_rgba(15,23,42,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.24)]",
          "flex flex-col",
        )}
      >
        <SidebarHeader className={cn("gap-2 p-3 shrink-0", !isExpanded && "p-2")}>
          <div className={cn("flex gap-2 shrink-0", isExpanded ? "items-center justify-between w-full" : "justify-center w-full")}>
            {isExpanded ? (
              <>
                <div className="min-w-0">
                  <div className="text-sm font-medium leading-none truncate">
                    Welcome{visitorFirstName ? ` ${visitorFirstName}` : ''}
                  </div>
                  {/* Hidden: section visibility counter (restore if needed)
                  <div className="text-xs text-sidebar-foreground/60 truncate">
                    {activeCount} of {dashboardSectionsConfig.length} sections
                  </div>
                  */}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarTrigger className="shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="right">Collapse sidebar</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarTrigger className="shrink-0" />
                </TooltipTrigger>
                <TooltipContent side="right">Expand sidebar</TooltipContent>
              </Tooltip>
            )}
          </div>
          <Separator className="bg-sidebar-border" />
          {isExpanded ? (
            <p
              className="text-sm leading-snug text-sidebar-foreground/60 mt-2 px-0.5"
              title={
                losLastSyncedAt
                  ? new Date(losLastSyncedAt).toLocaleString(undefined, {
                      dateStyle: 'full',
                      timeStyle: 'medium',
                    })
                  : undefined
              }
            >
              {formatDataLastSyncedLine(losLastSyncedAt)}
            </p>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex justify-center pt-2 pb-0.5" role="presentation">
                  <Database
                    className="h-4 w-4 text-sidebar-foreground/50"
                    aria-label={formatDataLastSyncedLine(losLastSyncedAt)}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[280px] text-sm">
                {formatDataLastSyncedLine(losLastSyncedAt)}
              </TooltipContent>
            </Tooltip>
          )}
        </SidebarHeader>

        <SidebarContent className={cn("pb-3 overflow-y-auto flex-1 min-h-0")}>
        <div className={cn("py-2", isExpanded ? "pl-1 pr-2" : "px-1")}>
          {/* Search moved to top nav - sidebar no longer shows search bar */}
          {/* Insights â€” Â§6.1 single control when unified */}
          {unifiedChatIa ? (
            <UnifiedSidebarInsightsNav isDarkMode={isDarkMode} collapsed={!isExpanded} />
          ) : (
          <div>
            {isExpanded ? (
              <>
            <button
              onClick={() => setInsightsExpanded(!insightsExpanded)}
              style={{ width: '100%', padding: '12px 10px', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10, transition: 'all 0.2s ease' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(100, 116, 139, 0.1)' }}>
                <LayoutGrid size={18} style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }} />
              </div>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: isDarkMode ? '#e2e8f0' : '#1a1d29', margin: 0, flex: 1 }}>Insights</h4>
              <ChevronDown size={18} style={{ color: isDarkMode ? '#94a3b8' : '#64748b', transform: insightsExpanded ? 'none' : 'rotate(-90deg)', transition: 'transform 0.2s ease' }} />
            </button>
            <AnimatePresence initial={false}>
              {insightsExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                  style={{ overflow: 'hidden' }}
                >
            {INSIGHTS_CHILDREN.map((it) => {
              if (it.type !== 'section') return null;
              const Icon = it.icon;
              const isActive = currentVisibility[it.id];
              return (
                <button
                  key={it.id}
                  onClick={() => handleSectionNavigation(it.id)}
                  style={{ width: '100%', padding: '12px 20px 12px 36px', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.2s ease' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: colorMap[it.color]?.bg || 'rgba(100, 116, 139, 0.1)' }}>
                    <Icon size={18} style={{ color: colorMap[it.color]?.text || '#64748b' }} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 500, color: isDarkMode ? '#e2e8f0' : '#1a1d29', flex: 1 }}>{it.label}</span>
                  <div
                    role="switch"
                    aria-checked={isActive}
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); handleToggleSection(it.id); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        handleToggleSection(it.id);
                      }
                    }}
                    style={{ flexShrink: 0, width: 32, height: 20, borderRadius: 9999, backgroundColor: isActive ? '#10b981' : (isDarkMode ? '#475569' : '#cbd5e1'), cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 2, justifyContent: isActive ? 'flex-end' : 'flex-start' }}
                  >
                    <div style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: 'white', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }} />
                  </div>
                </button>
              );
            })}
                </motion.div>
              )}
            </AnimatePresence>
            </>
            ) : (
            <Popover open={insightsFlyoutOpen} onOpenChange={setInsightsFlyoutOpen}>
              <PopoverTrigger asChild>
                <div
                  className="w-full"
                  onMouseEnter={() => {
                    if (flyoutLeaveRef.current) clearTimeout(flyoutLeaveRef.current);
                    setInsightsFlyoutOpen(true);
                  }}
                  onMouseLeave={() => {
                    flyoutLeaveRef.current = window.setTimeout(() => setInsightsFlyoutOpen(false), 150);
                  }}
                >
                  <button
                    type="button"
                    style={{ width: '100%', padding: '10px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(100, 116, 139, 0.1)' }}>
                      <LayoutGrid size={18} style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }} />
                    </div>
                  </button>
                </div>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                className="w-56 p-1"
                onMouseEnter={() => {
                  if (flyoutLeaveRef.current) clearTimeout(flyoutLeaveRef.current);
                  setInsightsFlyoutOpen(true);
                }}
                onMouseLeave={() => setInsightsFlyoutOpen(false)}
              >
                <div className="py-0.5">
                  {INSIGHTS_CHILDREN.filter((it): it is typeof INSIGHTS_CHILDREN[number] & { type: 'section' } => it.type === 'section').map((it) => {
                    const Icon = it.icon;
                    const isActive = currentVisibility[it.id];
                    return (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => { handleSectionNavigation(it.id); setInsightsFlyoutOpen(false); }}
                        className={cn("w-full flex items-center gap-2 rounded-md px-2 py-2 text-sm", isDarkMode ? "hover:bg-slate-700/50" : "hover:bg-slate-100")}
                      >
                        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", isActive ? (isDarkMode ? "bg-slate-600/50" : "bg-slate-200") : (isDarkMode ? "bg-slate-700/30" : "bg-slate-100"))}>
                          <Icon className="h-4 w-4" style={{ color: colorMap[it.color]?.text || '#64748b' }} />
                        </div>
                        <span className="flex-1 text-left truncate">{it.label}</span>
                        <div
                          role="switch"
                          aria-checked={isActive}
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); handleToggleSection(it.id); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              handleToggleSection(it.id);
                            }
                          }}
                          className={cn("shrink-0 w-8 h-5 rounded-full flex items-center p-0.5 transition-colors cursor-pointer", isActive ? "bg-emerald-500 justify-end" : (isDarkMode ? "bg-slate-600 justify-start" : "bg-slate-300 justify-start"))}
                        >
                          <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
            )}
          </div>
          )}

          {/* Dashboard submenus hidden from sidebar; only pinned items shown above */}

          {/* Toptiering - hidden from sidebar; routes available under Dashboards and via pinning */}
          {!HIDE_TOPTIERING_IN_SIDEBAR && (
          <div>
            {isExpanded ? (
              <>
            <button
              onClick={() => setToptieringExpanded(!toptieringExpanded)}
              style={{ width: '100%', padding: '12px 10px', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10, transition: 'all 0.2s ease' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(100, 116, 139, 0.1)' }}>
                <ArrowLeftRight size={18} style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }} />
              </div>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: isDarkMode ? '#e2e8f0' : '#1a1d29', margin: 0, flex: 1 }}>TopTiering</h4>
              <ChevronDown size={18} style={{ color: isDarkMode ? '#94a3b8' : '#64748b', transform: toptieringExpanded ? 'none' : 'rotate(-90deg)', transition: 'transform 0.2s ease' }} />
            </button>
            <AnimatePresence initial={false}>
              {toptieringExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                  style={{ overflow: 'hidden' }}
                >
            {TOPTIERING_GROUPS.map((group) => {
              const isExp = subExpanded[group.key];
              return (
                <div key={group.key}>
                  <button
                    onClick={() => setSubExpanded(group.key, !isExp)}
                    style={{ width: '100%', padding: '10px 20px 10px 36px', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s ease' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <p style={{ fontSize: 10, fontWeight: 600, color: isDarkMode ? '#94a3b8' : '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, flex: 1 }}>{group.label}</p>
                    <ChevronDown size={14} style={{ color: isDarkMode ? '#94a3b8' : '#64748b', flexShrink: 0, transform: isExp ? 'none' : 'rotate(-90deg)', transition: 'transform 0.2s ease' }} />
                  </button>
                  <AnimatePresence initial={false}>
                    {isExp && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        style={{ overflow: 'hidden' }}
                      >
                        {group.items.map((it) => {
                          const Icon = it.icon;
                          const handleNavToPath = () => navigate(it.path);
                          return (
                            <button
                              key={it.id}
                              onClick={handleNavToPath}
                              style={{ width: '100%', padding: '12px 20px 12px 36px', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.2s ease' }}
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                              <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(100, 116, 139, 0.1)' }}>
                                <Icon size={18} style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }} />
                              </div>
                              <span style={{ fontSize: 13, fontWeight: 500, color: isDarkMode ? '#e2e8f0' : '#1a1d29', flex: 1 }}>{it.label}</span>
                            </button>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
                </motion.div>
              )}
            </AnimatePresence>
            </>
            ) : (
            <Popover open={toptieringFlyoutOpen} onOpenChange={setToptieringFlyoutOpen}>
              <PopoverTrigger asChild>
                <div
                  className="w-full"
                  onMouseEnter={() => { if (flyoutLeaveRef.current) clearTimeout(flyoutLeaveRef.current); setToptieringFlyoutOpen(true); }}
                  onMouseLeave={() => { flyoutLeaveRef.current = window.setTimeout(() => setToptieringFlyoutOpen(false), 150); }}
                >
                  <button
                    type="button"
                    style={{ width: '100%', padding: '10px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(100, 116, 139, 0.1)' }}>
                      <ArrowLeftRight size={18} style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }} />
                    </div>
                  </button>
                </div>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                className="w-56 max-h-[70vh] overflow-y-auto p-1"
                onMouseEnter={() => { if (flyoutLeaveRef.current) clearTimeout(flyoutLeaveRef.current); setToptieringFlyoutOpen(true); }}
                onMouseLeave={() => setToptieringFlyoutOpen(false)}
              >
                <div className="py-0.5 space-y-1">
                  {TOPTIERING_GROUPS.map((group) => (
                    <div key={group.key}>
                      <div className="px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</div>
                      {group.items.map((it) => {
                        const Icon = it.icon;
                        const isCurrent = location.pathname === it.path;
                        return (
                          <button
                            key={it.id}
                            type="button"
                            onClick={() => { navigate(it.path); setToptieringFlyoutOpen(false); }}
                            className={cn("w-full flex items-center gap-2 rounded-md px-2 py-2 text-sm", isDarkMode ? "hover:bg-slate-700/50" : "hover:bg-slate-100", isCurrent && (isDarkMode ? "bg-slate-700/40" : "bg-slate-100"))}
                          >
                            <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", isCurrent ? (isDarkMode ? "bg-slate-600/50" : "bg-slate-200") : (isDarkMode ? "bg-slate-700/30" : "bg-slate-100"))}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <span className="flex-1 text-left truncate">{it.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            )}
          </div>
          )}

          {/* Dashboard - category always shown; submenu shows pinned items from top nav */}
          {isExpanded ? (
            <div className={cn("mb-2")}>
              <button
                type="button"
                onClick={() => setDashboardsExpanded(!dashboardsExpanded)}
                style={{ width: '100%', padding: '12px 10px', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10, transition: 'all 0.2s ease' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-slate-100 dark:bg-slate-800/30">
                  <TrendingUp className="w-[18px] h-[18px] text-slate-600 dark:text-slate-400" />
                </div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex-1 m-0">My Dashboards</p>
                <ChevronDown size={18} style={{ color: isDarkMode ? '#94a3b8' : '#64748b', transform: dashboardsExpanded ? 'none' : 'rotate(-90deg)', transition: 'transform 0.2s ease' }} />
              </button>
              <AnimatePresence initial={false}>
                {dashboardsExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="space-y-0.5">
                      {pinnedItems.length === 0 && favoriteCanvases.length === 0 ? (
                        <p className="px-2 py-2 text-xs text-slate-500 dark:text-slate-400">{EMPTY_MY_DASHBOARDS_HINT}</p>
                      ) : (
                        <DndContext
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragEnd={handleMyDashboardsDragEnd}
                        >
                          <SortableContext
                            items={myDashboardsSortableIds}
                            strategy={verticalListSortingStrategy}
                          >
                            {pinnedItems.map((item) => {
                              const { Icon, iconColor } = getIconAndColorForPinnedItem(item);
                              const style = navIconStyleMap[iconColor] ?? navIconStyleMap.blue;
                              const itemId = getPinnedItemId(item);
                              const label = item.type === 'section' ? getSectionLabel(item.id) : item.label;
                              const isCurrent = item.type === 'route' && location.pathname === item.path;
                              return (
                                <SortablePinnedItem
                                  key={itemId}
                                  id={itemId}
                                  item={item}
                                  isDarkMode={isDarkMode}
                                  isCurrent={isCurrent}
                                  label={label}
                                  Icon={Icon}
                                  style={style}
                                  onNavigate={() => item.type === 'route' && navigate(item.path)}
                                  onRemove={() => removePinned(item)}
                                  onSectionClick={item.type === 'section' ? handleSectionNavigation : undefined}
                                />
                              );
                            })}
                            {favoriteCanvases.map((canvas) => (
                              <WorkbenchCanvasSidebarRow
                                key={`canvas-${canvas.id}`}
                                canvas={canvas}
                                isDarkMode={isDarkMode}
                                isCurrent={location.pathname === `/my-dashboard/${canvas.id}`}
                                onNavigate={() => navigate(`/my-dashboard/${canvas.id}`)}
                                onUnpin={() => void toggleCanvasFavorite(canvas.id, false)}
                              />
                            ))}
                          </SortableContext>
                        </DndContext>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <Popover open={pinnedDashboardFlyoutOpen} onOpenChange={setPinnedDashboardFlyoutOpen}>
              <PopoverTrigger asChild>
                <div
                  className="w-full flex justify-center py-2"
                  onMouseEnter={() => { if (flyoutLeaveRef.current) clearTimeout(flyoutLeaveRef.current); setPinnedDashboardFlyoutOpen(true); }}
                  onMouseLeave={() => { flyoutLeaveRef.current = window.setTimeout(() => setPinnedDashboardFlyoutOpen(false), 150); }}
                >
                  <button
                    type="button"
                    className="w-9 h-9 rounded-lg flex items-center justify-center bg-slate-50 dark:bg-slate-800/30"
                    aria-label="My Dashboards"
                  >
                    <TrendingUp className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                  </button>
                </div>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                className="w-56 p-2"
                onMouseEnter={() => { if (flyoutLeaveRef.current) clearTimeout(flyoutLeaveRef.current); setPinnedDashboardFlyoutOpen(true); }}
                onMouseLeave={() => { flyoutLeaveRef.current = window.setTimeout(() => setPinnedDashboardFlyoutOpen(false), 150); }}
              >
                <div className="flex items-center gap-2 px-2 pb-2">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-slate-100 dark:bg-slate-800/30">
                    <TrendingUp className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                  </div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">My Dashboards</p>
                </div>
                <div className="space-y-0.5">
                  {pinnedItems.length === 0 && favoriteCanvases.length === 0 ? (
                    <p className="px-2 py-3 text-xs text-slate-500 dark:text-slate-400">{EMPTY_MY_DASHBOARDS_HINT}</p>
                  ) : (
                    <>
                  {pinnedItems.map((item) => {
                    const { Icon, iconColor } = getIconAndColorForPinnedItem(item);
                    const style = navIconStyleMap[iconColor] ?? navIconStyleMap.blue;
                    if (item.type === 'section') {
                      const label = getSectionLabel(item.id);
                      return (
                        <div key={`section-${item.id}`} className="flex items-center gap-1 group rounded-md">
                          <button type="button" onClick={() => { handleSectionNavigation(item.id); setPinnedDashboardFlyoutOpen(false); }} className="flex-1 flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800/60 min-w-0">
                            <div className={cn("flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center", style.bg)}>
                              <Icon className={cn("w-4 h-4", style.icon)} />
                            </div>
                            <span className="truncate">{label}</span>
                          </button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); removePinned(item); }} className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-slate-200/60 dark:hover:bg-slate-600/60" title="Unpin"><PinOff className="w-3.5 h-3.5 text-amber-500" /></button>
                        </div>
                      );
                    }
                    const isCurrent = location.pathname === item.path;
                    return (
                      <div key={`route-${item.id}`} className="flex items-center gap-1 group rounded-md">
                        <button type="button" onClick={() => { navigate(item.path); setPinnedDashboardFlyoutOpen(false); }} className={cn("flex-1 flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800/60 min-w-0", isCurrent && "bg-slate-100 dark:bg-slate-800/40")}>
                          <div className={cn("flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center", style.bg, isCurrent && "ring-1 ring-emerald-400/50")}>
                            <Icon className={cn("w-4 h-4", isCurrent ? "text-emerald-500 dark:text-emerald-400" : style.icon)} />
                          </div>
                          <span className="truncate">{item.label}</span>
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); removePinned(item); }} className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-slate-200/60 dark:hover:bg-slate-600/60" title="Unpin"><PinOff className="w-3.5 h-3.5 text-amber-500" /></button>
                      </div>
                    );
                  })}
                  {favoriteCanvases.map((canvas) => (
                    <WorkbenchCanvasSidebarRow
                      key={`canvas-${canvas.id}`}
                      canvas={canvas}
                      isDarkMode={isDarkMode}
                      isCurrent={location.pathname === `/my-dashboard/${canvas.id}`}
                      variant="popover"
                      onNavigate={() => {
                        navigate(`/my-dashboard/${canvas.id}`);
                        setPinnedDashboardFlyoutOpen(false);
                      }}
                      onUnpin={() => void toggleCanvasFavorite(canvas.id, false)}
                    />
                  ))}
                    </>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {unifiedChatIa && (
            <UnifiedChatSidebarSections
              tenantId={selectedTenantId ?? undefined}
              isDarkMode={isDarkMode}
              isExpanded={isExpanded}
            />
          )}

          {!unifiedChatIa && (
          <>
          {/* Research Lab */}
          {isExpanded ? (
            <div>
              <button
                type="button"
                onClick={() => setResearchExpanded(!researchExpanded)}
                style={{ width: '100%', padding: '12px 10px', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10, transition: 'all 0.2s ease' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(100, 116, 139, 0.1)' }}>
                  <FlaskConical size={18} style={{ color: isPathActive('/research') ? '#10b981' : (isDarkMode ? '#94a3b8' : '#64748b') }} />
                </div>
                <h4 style={{ fontSize: 14, fontWeight: 600, color: isDarkMode ? '#e2e8f0' : '#1a1d29', margin: 0, flex: 1 }}>Research Lab</h4>
                <ChevronDown size={18} style={{ color: isDarkMode ? '#94a3b8' : '#64748b', transform: researchExpanded ? 'none' : 'rotate(-90deg)', transition: 'transform 0.2s ease' }} />
              </button>
              <AnimatePresence initial={false}>
                {researchExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    style={{ overflow: 'hidden' }}
                  >
                    <button
                      type="button"
                      onClick={() => navigate('/research')}
                      style={{ width: '100%', padding: '12px 20px 12px 36px', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.2s ease', fontSize: 13, fontWeight: 500, color: isDarkMode ? '#e2e8f0' : '#1a1d29' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      Open Research Lab
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  style={{ width: '100%', padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, transition: 'all 0.2s ease', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  onClick={() => navigate('/research')}
                >
                  <button onClick={(e) => { e.stopPropagation(); navigate('/research'); }} style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(100, 116, 139, 0.1)', border: 'none', cursor: 'pointer' }}>
                    <FlaskConical size={18} style={{ color: isPathActive('/research') ? '#10b981' : (isDarkMode ? '#94a3b8' : '#64748b') }} />
                  </button>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">Research Lab</TooltipContent>
            </Tooltip>
          )}
          </>
          )}

          {!unifiedChatIa && (
          <>
          {/* Communications Center */}
          {isExpanded ? (
            <div
              style={{ width: '100%', padding: '12px 10px', display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.2s ease', cursor: 'pointer' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              onClick={() => navigate('/workbench/distributions')}
            >
              <button onClick={(e) => { e.stopPropagation(); navigate('/workbench/distributions'); }} style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(100, 116, 139, 0.1)', border: 'none', cursor: 'pointer' }}>
                <Mail size={18} style={{ color: isPathActive('/workbench/distributions') ? '#10b981' : (isDarkMode ? '#94a3b8' : '#64748b') }} />
              </button>
              <button onClick={() => navigate('/workbench/distributions')} style={{ flex: 1, fontSize: 14, fontWeight: 600, color: isDarkMode ? '#e2e8f0' : '#1a1d29', textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>Communications Center</button>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  style={{ width: '100%', padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, transition: 'all 0.2s ease', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  onClick={() => navigate('/workbench/distributions')}
                >
                  <button onClick={(e) => { e.stopPropagation(); navigate('/workbench/distributions'); }} style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(100, 116, 139, 0.1)', border: 'none', cursor: 'pointer' }}>
                    <Mail size={18} style={{ color: isPathActive('/workbench/distributions') ? '#10b981' : (isDarkMode ? '#94a3b8' : '#64748b') }} />
                  </button>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">Communications Center</TooltipContent>
            </Tooltip>
          )}
          </>
          )}
        </div>
        </SidebarContent>

        <SidebarRail />
      </Sidebar>
    </>
  );
};
