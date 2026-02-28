import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Zap, BarChart3, Target, Check, Home, Trophy, X, Sun, FileText, LayoutGrid, TrendingUp, LayoutDashboard, Filter, ArrowLeftRight, Shield, ClipboardList, Calculator, LineChart } from 'lucide-react';
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
import {
  SidebarRouteSearch,
  type SidebarRouteSearchTarget,
} from '@/components/dashboard/SidebarRouteSearch';

export interface DashboardVisibility {
  executiveDashboard: boolean;
  industryNews: boolean;
  aletheiaInsights: boolean;
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
  { id: 'aletheiaInsights' as SectionId, label: 'Cohi Daily Briefings', icon: Sun, color: 'text-emerald-500', section: 'main' },
  { id: 'industryNews' as SectionId, label: 'Mortgage News', icon: FileText, color: 'text-blue-500', section: 'main' },
  { id: 'leaderboard' as SectionId, label: 'Leaderboard', icon: Trophy, color: 'text-amber-500', section: 'dashboards' },
  { id: 'executiveDashboard' as SectionId, label: 'Business Overview', icon: Target, color: 'text-blue-500', section: 'dashboards' },
  { id: 'closingFalloutForecast' as SectionId, label: 'Closing & Fallout Forecast', icon: BarChart3, color: 'text-indigo-500', section: 'dashboards' },
];

// Default section order - matches actual display order on /insights page
export const defaultSectionOrder: SectionId[] = [
  'aletheiaInsights',
  'industryNews',
  'leaderboard',
  'executiveDashboard',
  'closingFalloutForecast',
];

// Nav menu structure mirroring top Navigation (keep sidemenu icons: Sun, FileText, Trophy, Target, BarChart3 for sections)
const INSIGHTS_CHILDREN = [
  { type: 'section' as const, id: 'aletheiaInsights' as SectionId, label: 'Cohi Daily Briefings', icon: Sun, color: 'text-emerald-500' },
  { type: 'section' as const, id: 'industryNews' as SectionId, label: 'Mortgage News', icon: FileText, color: 'text-blue-500' },
];

// Dashboard floating menu items (Leaderboard, Business Overview, Closing & Fallout Forecast)
const DASHBOARD_FLOATING_ITEMS: { id: SectionId; label: string; icon: typeof Trophy; color: string }[] = [
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy, color: 'text-amber-500' },
  { id: 'executiveDashboard', label: 'Business Overview', icon: Target, color: 'text-blue-500' },
  { id: 'closingFalloutForecast', label: 'Closing & Fallout Forecast', icon: BarChart3, color: 'text-indigo-500' },
];

type SubsectionKey = 'dashboard' | 'topTiering' | 'sales' | 'operations' | 'financialModeling';

const DASHBOARD_CHILDREN = [
  { type: 'subheader' as const, label: 'Dashboard', subsectionKey: 'dashboard' as SubsectionKey },
  { type: 'section' as const, id: 'leaderboard' as SectionId, label: 'Leaderboard', icon: Trophy, color: 'text-amber-500', subsectionKey: 'dashboard' as SubsectionKey },
  { type: 'section' as const, id: 'executiveDashboard' as SectionId, label: 'Business Overview', icon: Target, color: 'text-blue-500', subsectionKey: 'dashboard' as SubsectionKey },
  { type: 'section' as const, id: 'closingFalloutForecast' as SectionId, label: 'Closing & Fallout Forecast', icon: BarChart3, color: 'text-indigo-500', subsectionKey: 'dashboard' as SubsectionKey },
];

// Submenus under Toptiering main menu (Core Analytics, Sales, Operations, Financial Modeling)
const TOPTIERING_CHILDREN = [
  { type: 'subheader' as const, label: 'Core Analytics', subsectionKey: 'topTiering' as SubsectionKey },
  { type: 'route' as const, id: 'loanFunnel', label: 'Loan Funnel', icon: Filter, path: '/loan-funnel', subsectionKey: 'topTiering' as SubsectionKey },
  { type: 'route' as const, id: 'topTieringComparison', label: 'TopTiering Comparison', icon: ArrowLeftRight, path: '/performance/toptiering-comparison', subsectionKey: 'topTiering' as SubsectionKey },
  { type: 'route' as const, id: 'creditRiskManagement', label: 'Credit Risk Management', icon: Shield, path: '/credit-risk-management', subsectionKey: 'topTiering' as SubsectionKey },
  { type: 'route' as const, id: 'companyScorecard', label: 'Company Scorecard', icon: ClipboardList, path: '/company-scorecard', subsectionKey: 'topTiering' as SubsectionKey },
  { type: 'subheader' as const, label: 'Sales', subsectionKey: 'sales' as SubsectionKey },
  { type: 'route' as const, id: 'salesScorecard', label: 'Scorecard', icon: Target, path: '/sales-scorecard', subsectionKey: 'sales' as SubsectionKey },
  { type: 'route' as const, id: 'salesTrends', label: 'Trends', icon: TrendingUp, path: '/sales-trends', subsectionKey: 'sales' as SubsectionKey },
  { type: 'subheader' as const, label: 'Operations', subsectionKey: 'operations' as SubsectionKey },
  { type: 'route' as const, id: 'operationsScorecard', label: 'Scorecard', icon: Target, path: '/performance/operation-scorecard', subsectionKey: 'operations' as SubsectionKey },
  { type: 'route' as const, id: 'operationsTrends', label: 'Trends', icon: LineChart, path: '/performance/operation-scorecard-trends', subsectionKey: 'operations' as SubsectionKey },
  { type: 'subheader' as const, label: 'Financial Modeling', subsectionKey: 'financialModeling' as SubsectionKey },
  { type: 'route' as const, id: 'financialModeling', label: 'Financial Modeling Sandbox', icon: Calculator, path: '/performance/financial-modeling-sandbox', subsectionKey: 'financialModeling' as SubsectionKey },
];

type ToptieringRouteItem = Extract<(typeof TOPTIERING_CHILDREN)[number], { type: 'route' }>;
const TOPTIERING_GROUPS: Array<{ key: SubsectionKey; label: string; items: ToptieringRouteItem[] }> = [
  { key: 'topTiering', label: 'Core Analytics', items: TOPTIERING_CHILDREN.filter((it): it is ToptieringRouteItem => it.type === 'route' && it.subsectionKey === 'topTiering') },
  { key: 'sales', label: 'Sales', items: TOPTIERING_CHILDREN.filter((it): it is ToptieringRouteItem => it.type === 'route' && it.subsectionKey === 'sales') },
  { key: 'operations', label: 'Operations', items: TOPTIERING_CHILDREN.filter((it): it is ToptieringRouteItem => it.type === 'route' && it.subsectionKey === 'operations') },
  { key: 'financialModeling', label: 'Financial Modeling', items: TOPTIERING_CHILDREN.filter((it): it is ToptieringRouteItem => it.type === 'route' && it.subsectionKey === 'financialModeling') },
];

// Color mapping for section colors
const colorMap: Record<string, { bg: string; text: string }> = {
  'text-emerald-500': { bg: 'rgba(16, 185, 129, 0.1)', text: '#10b981' },
  'text-blue-500': { bg: 'rgba(59, 130, 246, 0.1)', text: '#3b82f6' },
  'text-amber-500': { bg: 'rgba(245, 158, 11, 0.1)', text: '#f59e0b' },
  'text-indigo-500': { bg: 'rgba(99, 102, 241, 0.1)', text: '#6366f1' },
  'text-violet-500': { bg: 'rgba(139, 92, 246, 0.1)', text: '#8b5cf6' },
};

// Bypass Landing Page Toggle Component
const BypassLandingToggle = ({ isExpanded }: { isExpanded: boolean }) => {
  const [bypassEnabled, setBypassEnabled] = useState(() => {
    const stored = localStorage.getItem('bypass-landing-page');
    return stored === 'true';
  });

  const handleToggle = () => {
    const newValue = !bypassEnabled;
    setBypassEnabled(newValue);
    localStorage.setItem('bypass-landing-page', String(newValue));
  };

  return (
    <div className={`
      w-full flex items-center rounded-xl transition-all duration-150 group 
      hover:bg-slate-100/80 dark:hover:bg-slate-800/80 
      ${isExpanded ? 'h-11 gap-2 px-2' : 'h-10'}
    `}
    style={{ justifyContent: isExpanded ? 'flex-start' : 'center' }}
    >
      {/* Icon */}
      <button
        onClick={handleToggle}
        className="relative flex-shrink-0"
      >
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors duration-150 ${bypassEnabled ? 'bg-slate-100 dark:bg-slate-800/60' : 'bg-slate-50 dark:bg-slate-800/30'}`}>
          <Home className={`w-4 h-4 ${bypassEnabled ? 'text-blue-500' : 'text-slate-400 dark:text-slate-500'}`} />
        </div>
        {/* Checkbox indicator */}
        <div className={`absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center transition-all duration-150 ${bypassEnabled ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
          {bypassEnabled && <Check className="w-2 h-2 text-white" strokeWidth={3} />}
        </div>
      </button>
      
      {/* Content - only render when expanded */}
      {isExpanded && (
        <>
          <button
            onClick={handleToggle}
            className="flex-1 min-w-0 text-left overflow-hidden"
          >
            <p className={`text-xs font-semibold truncate leading-tight transition-colors ${bypassEnabled ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>
              Bypass Landing Page
            </p>
            <p className={`text-[10px] mt-0.5 ${bypassEnabled ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`}>
              {bypassEnabled ? 'Go straight to dashboard' : 'Show landing page'}
            </p>
          </button>
          
          {/* Toggle indicator */}
          <button
            onClick={handleToggle}
            className="flex-shrink-0"
          >
            <div className={`w-8 h-5 rounded-full transition-colors duration-150 flex items-center ${bypassEnabled ? 'bg-blue-500 justify-end' : 'bg-slate-300 dark:bg-slate-600 justify-start'}`}>
              <div className="w-4 h-4 rounded-full bg-white shadow-sm mx-0.5" />
            </div>
          </button>
        </>
      )}
    </div>
  );
};

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
  const isInsightsPage = location.pathname === '/insights';
  const isDashboardPage = isInsightsPage; // dashboard content moved to /insights
  const [internalMobileOpen, setInternalMobileOpen] = useState(false);
  const [insightsFlyoutOpen, setInsightsFlyoutOpen] = useState(false);
  const [dashboardsFlyoutOpen, setDashboardsFlyoutOpen] = useState(false);
  const [toptieringFlyoutOpen, setToptieringFlyoutOpen] = useState(false);
  const flyoutLeaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMobileOpen = externalMobileOpen !== undefined ? externalMobileOpen : internalMobileOpen;
  const [insightsExpanded, setInsightsExpanded] = useState(true);
  const [dashboardExpanded, setDashboardExpanded] = useState(true);
  const [toptieringExpanded, setToptieringExpanded] = useState(false);
  const [topTieringSubExpanded, setTopTieringSubExpanded] = useState(true);
  const [salesSubExpanded, setSalesSubExpanded] = useState(true);
  const [operationsSubExpanded, setOperationsSubExpanded] = useState(true);
  const [financialModelingSubExpanded, setFinancialModelingSubExpanded] = useState(true);
  const realtimeStats = useRealtimeStats();

  const searchTargets: SidebarRouteSearchTarget[] = useMemo(() => {
    const sectionTargets: SidebarRouteSearchTarget[] = [
      ...INSIGHTS_CHILDREN.filter((it): it is typeof INSIGHTS_CHILDREN[number] & { type: 'section' } => it.type === "section").map((it) => ({
        id: `section:${it.id}`,
        label: it.label,
        group: "Insights",
        kind: "section" as const,
        sectionId: it.id,
        keywords: ["insights", "dashboard"],
      })),
      ...DASHBOARD_CHILDREN.filter((it): it is Extract<typeof DASHBOARD_CHILDREN[number], { type: "section" }> => it.type === "section").map((it) => ({
        id: `section:${it.id}`,
        label: it.label,
        group: "Dashboards",
        kind: "section" as const,
        sectionId: it.id,
        keywords: ["dashboards", "insights"],
      })),
    ];

    const toptieringTargets: SidebarRouteSearchTarget[] = TOPTIERING_CHILDREN.filter(
      (it): it is Extract<typeof TOPTIERING_CHILDREN[number], { type: "route" }> => it.type === "route",
    ).map((it) => ({
      id: `route:${it.id}`,
      label: it.label,
      group: "TopTiering",
      kind: "route" as const,
      path: it.path,
      keywords: ["toptiering", "top tiering", "performance"],
    }));

    const pageTargets: SidebarRouteSearchTarget[] = [
      { id: "route:insights", label: "Insights", group: "Pages", kind: "route", path: "/insights", keywords: ["home", "dashboard"] },
      { id: "route:my-workbench", label: "My Workbench", group: "Pages", kind: "route", path: "/my-dashboard", keywords: ["workbench", "canvas"] },
      { id: "route:research", label: "Research Lab", group: "Pages", kind: "route", path: "/research", keywords: ["research"] },
      { id: "route:loans", label: "Loans", group: "Pages", kind: "route", path: "/loans", keywords: ["pipeline"] },
      { id: "route:settings", label: "Settings", group: "Pages", kind: "route", path: "/settings", keywords: ["profile", "preferences"] },
      { id: "route:help", label: "Help Center", group: "Pages", kind: "route", path: "/help", keywords: ["support", "docs"] },
      { id: "route:workbench-shared", label: "Workbench: Shared With Me", group: "Pages", kind: "route", path: "/workbench/shared", keywords: ["workbench", "shared"] },
      { id: "route:workbench-team", label: "Workbench: Team Folders", group: "Pages", kind: "route", path: "/workbench/team-folders", keywords: ["workbench", "team"] },
      { id: "route:workbench-favorites", label: "Workbench: Favorites", group: "Pages", kind: "route", path: "/workbench/favorites", keywords: ["workbench", "favorites"] },
    ];

    return [...sectionTargets, ...toptieringTargets, ...pageTargets];
  }, []);

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
    aletheiaInsights: true,
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
                      ? `${[currentVisibility.aletheiaInsights, currentVisibility.industryNews].filter(Boolean).length} of 2`
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
              
              {isInsightsPage ? (
                /* /insights mobile: only Cohi Daily Briefings + Mortgage News */
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
                            it.id === 'aletheiaInsights'
                              ? 'bg-emerald-500/10 dark:bg-emerald-500/20'
                              : 'bg-blue-500/10 dark:bg-blue-500/20'
                          )}
                        >
                          <Icon
                            className={cn(
                              'w-5 h-5',
                              it.id === 'aletheiaInsights'
                                ? 'text-emerald-500 dark:text-emerald-400'
                                : 'text-blue-500 dark:text-blue-400'
                            )}
                          />
                        </div>
                        <button
                          onClick={() => { onSectionClick?.(it.id); onMobileMenuToggle?.(); }}
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
                {/* Insights */}
                <div>
                  <button
                    onClick={() => setInsightsExpanded(!insightsExpanded)}
                    className="w-full flex items-center gap-3 p-3 min-h-[44px] rounded-xl hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-all touch-manipulation"
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-slate-50 dark:bg-slate-800/30">
                      <LayoutGrid className="w-5 h-5 text-slate-600 dark:text-slate-400" />
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
                              onClick={() => { onSectionClick?.(it.id); onMobileMenuToggle?.(); }}
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

                {/* Dashboard */}
                <div>
                  <button
                    onClick={() => setDashboardExpanded(!dashboardExpanded)}
                    className="w-full flex items-center gap-3 p-3 min-h-[44px] rounded-xl hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-all touch-manipulation"
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-slate-50 dark:bg-slate-800/30">
                      <TrendingUp className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200 flex-1 text-left">Dashboards</p>
                    <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform duration-200", !dashboardExpanded && "-rotate-90")} />
                  </button>
                  <AnimatePresence initial={false}>
                    {dashboardExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        className="overflow-hidden"
                      >
                        <div className="pl-4 pr-2 pb-2 space-y-1">
                      {DASHBOARD_CHILDREN.map((it, i) => {
                        if (it.type === 'subheader') {
                          const key = it.subsectionKey;
                          if (key === 'dashboard') {
                            return (
                              <div key={`sh-${i}`} className="px-2 pt-3 pb-1">
                                <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{it.label}</p>
                              </div>
                            );
                          }
                          const isExp = subExpanded[key];
                          return (
                            <button
                              key={`sh-${i}`}
                              type="button"
                              onClick={() => setSubExpanded(key, !isExp)}
                              className="w-full flex items-center gap-2 px-2 pt-2 pb-1 min-h-[44px] rounded-lg hover:bg-slate-100/80 dark:hover:bg-slate-800/80 text-left touch-manipulation"
                            >
                              <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex-1">{it.label}</p>
                              <ChevronDown className={cn("w-3.5 h-3.5 text-slate-400 flex-shrink-0 transition-transform", !isExp && "-rotate-90")} />
                            </button>
                          );
                        }
                        if (!subExpanded[it.subsectionKey]) return null;
                        if (it.type === 'section') {
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
                              <button onClick={() => { onSectionClick?.(it.id); onMobileMenuToggle?.(); }} className="flex-1 text-left text-sm text-slate-700 dark:text-slate-300 min-h-[44px] flex items-center">{it.label}</button>
                              <button onClick={() => handleToggleSection(it.id)} className={cn("w-8 h-5 min-w-[44px] min-h-[44px] rounded-full flex items-center transition-colors touch-manipulation", isActive ? "bg-emerald-500 justify-end" : "bg-slate-300 dark:bg-slate-600 justify-start")}>
                                <div className="w-4 h-4 rounded-full bg-white shadow-sm mx-0.5" />
                              </button>
                            </div>
                          );
                        }
                        const Icon = it.icon;
                        const isCurrent = location.pathname === (it as { path?: string }).path;
                        const vid = 'visibilityId' in it ? (it as { visibilityId?: SectionId }).visibilityId : undefined;
                        if (vid) {
                          const isActive = currentVisibility[vid];
                          return (
                            <div key={it.id} className="flex items-center gap-2 p-2.5 min-h-[44px] rounded-lg hover:bg-slate-100/80 dark:hover:bg-slate-800/80 touch-manipulation">
                              <button onClick={() => { navigate(it.path); onMobileMenuToggle?.(); }} className="relative flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center">
                                <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-slate-50 dark:bg-slate-800/30">
                                  <Icon className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                                </div>
                              </button>
                              <button onClick={() => { navigate(it.path); onMobileMenuToggle?.(); }} className="flex-1 text-left text-sm font-medium text-slate-800 dark:text-slate-200 min-h-[44px] flex items-center">{it.label}</button>
                              <button onClick={(e) => { e.stopPropagation(); handleToggleSection(vid); }} className={cn("w-8 h-5 min-w-[44px] min-h-[44px] rounded-full flex items-center transition-colors touch-manipulation", isActive ? "bg-emerald-500 justify-end" : "bg-slate-300 dark:bg-slate-600 justify-start")}>
                                <div className="w-4 h-4 rounded-full bg-white shadow-sm mx-0.5" />
                              </button>
                            </div>
                          );
                        }
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

                {/* Toptiering - main menu like Dashboards, submenus: Core Analytics, Sales, Operations, Financial Modeling */}
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

                {/* My Workbench */}
                <div className={cn("flex items-center gap-2 p-2.5 min-h-[44px] rounded-lg hover:bg-slate-100/80 dark:hover:bg-slate-800/80 touch-manipulation", location.pathname === '/my-dashboard' && "bg-slate-100 dark:bg-slate-800/60")}>
                  <button onClick={() => { navigate('/my-dashboard'); onMobileMenuToggle?.(); }} className="relative flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center">
                    <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", location.pathname === '/my-dashboard' ? "bg-slate-100 dark:bg-slate-800/60" : "bg-slate-50 dark:bg-slate-800/30")}>
                      <LayoutDashboard className={cn("w-4 h-4", location.pathname === '/my-dashboard' ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400")} />
                    </div>
                  </button>
                  <button onClick={() => { navigate('/my-dashboard'); onMobileMenuToggle?.(); }} className="flex-1 text-left text-sm text-slate-700 dark:text-slate-300 min-h-[44px] flex items-center">My Workbench</button>
                  <button onClick={(e) => { e.stopPropagation(); handleToggleSection('myWorkbench'); }} className={cn("w-8 h-5 min-w-[44px] min-h-[44px] rounded-full flex items-center transition-colors touch-manipulation", currentVisibility.myWorkbench ? "bg-emerald-500 justify-end" : "bg-slate-300 dark:bg-slate-600 justify-start")}>
                    <div className="w-4 h-4 rounded-full bg-white shadow-sm mx-0.5" />
                  </button>
                </div>
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

      {/* Desktop: same behavior/styles as /admin-v2 — fixed, scrollable content, header with expand/collapse */}
      <Sidebar
        variant="inset"
        collapsible="icon"
        className={cn(
          "top-16 h-[calc(100vh-4rem)] p-0 z-30",
          "border-blue-200/40 dark:border-slate-700/50 bg-white/95 dark:bg-slate-800/80 backdrop-blur-xl",
          "shadow-[0_8px_30px_rgba(59,130,246,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.3)]",
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
                  <div className="text-xs text-sidebar-foreground/60 truncate">
                    {activeCount} of {dashboardSectionsConfig.length} sections
                  </div>
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
        </SidebarHeader>

        <SidebarContent className={cn("pb-3 overflow-y-auto flex-1 min-h-0")}>
        <div className={cn("py-2", isExpanded ? "pl-1 pr-2" : "px-1")}>
          <div className={cn("mb-2", isExpanded ? "px-1" : "px-0")}>
            <SidebarRouteSearch targets={searchTargets} collapsed={!isExpanded} />
          </div>
          {/* Insights */}
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
                  onClick={() => onSectionClick?.(it.id)}
                  style={{ width: '100%', padding: '12px 20px 12px 36px', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.2s ease' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: colorMap[it.color]?.bg || 'rgba(100, 116, 139, 0.1)' }}>
                    <Icon size={18} style={{ color: colorMap[it.color]?.text || '#64748b' }} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 500, color: isDarkMode ? '#e2e8f0' : '#1a1d29', flex: 1 }}>{it.label}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggleSection(it.id); }}
                    style={{ flexShrink: 0, width: 32, height: 20, borderRadius: 9999, backgroundColor: isActive ? '#10b981' : (isDarkMode ? '#475569' : '#cbd5e1'), border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 2, justifyContent: isActive ? 'flex-end' : 'flex-start' }}
                  >
                    <div style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: 'white', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }} />
                  </button>
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
                        onClick={() => { onSectionClick?.(it.id); setInsightsFlyoutOpen(false); }}
                        className={cn("w-full flex items-center gap-2 rounded-md px-2 py-2 text-sm", isDarkMode ? "hover:bg-slate-700/50" : "hover:bg-slate-100")}
                      >
                        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", isActive ? (isDarkMode ? "bg-slate-600/50" : "bg-slate-200") : (isDarkMode ? "bg-slate-700/30" : "bg-slate-100"))}>
                          <Icon className="h-4 w-4" style={{ color: colorMap[it.color]?.text || '#64748b' }} />
                        </div>
                        <span className="flex-1 text-left truncate">{it.label}</span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleToggleSection(it.id); }}
                          className={cn("shrink-0 w-8 h-5 rounded-full flex items-center p-0.5 transition-colors", isActive ? "bg-emerald-500 justify-end" : (isDarkMode ? "bg-slate-600 justify-start" : "bg-slate-300 justify-start"))}
                        >
                          <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
                        </button>
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
            )}
          </div>

          {/* Dashboard */}
          <div>
            {isExpanded ? (
              <>
            <button
              onClick={() => setDashboardExpanded(!dashboardExpanded)}
              style={{ width: '100%', padding: '12px 10px', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10, transition: 'all 0.2s ease' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(100, 116, 139, 0.1)' }}>
                <TrendingUp size={18} style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }} />
              </div>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: isDarkMode ? '#e2e8f0' : '#1a1d29', margin: 0, flex: 1 }}>Dashboards</h4>
              <ChevronDown size={18} style={{ color: isDarkMode ? '#94a3b8' : '#64748b', transform: dashboardExpanded ? 'none' : 'rotate(-90deg)', transition: 'transform 0.2s ease' }} />
            </button>
            <AnimatePresence initial={false}>
              {dashboardExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                  style={{ overflow: 'hidden' }}
                >
            {DASHBOARD_CHILDREN.map((it, i) => {
              if (it.type === 'subheader') {
                const key = it.subsectionKey;
                if (key === 'dashboard') {
                  return (
                    <div key={`sh-${i}`} style={{ padding: '12px 20px 4px 36px' }}>
                      <p style={{ fontSize: 10, fontWeight: 600, color: isDarkMode ? '#94a3b8' : '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>{it.label}</p>
                    </div>
                  );
                }
                const isExp = subExpanded[key];
                return (
                  <button
                    key={`sh-${i}`}
                    onClick={() => setSubExpanded(key, !isExp)}
                    style={{ width: '100%', padding: '10px 20px 10px 36px', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s ease' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <p style={{ fontSize: 10, fontWeight: 600, color: isDarkMode ? '#94a3b8' : '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, flex: 1 }}>{it.label}</p>
                    <ChevronDown size={14} style={{ color: isDarkMode ? '#94a3b8' : '#64748b', flexShrink: 0, transform: isExp ? 'none' : 'rotate(-90deg)' }} />
                  </button>
                );
              }
              const skip = !subExpanded[it.subsectionKey];
              if (skip) return null;
              if (it.type === 'section') {
                const Icon = it.icon;
                const isActive = currentVisibility[it.id];
                return (
                  <button
                    key={it.id}
                    onClick={() => onSectionClick?.(it.id)}
                    style={{ width: '100%', padding: '12px 20px 12px 36px', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.2s ease' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: colorMap[it.color]?.bg || 'rgba(100, 116, 139, 0.1)' }}>
                      <Icon size={18} style={{ color: colorMap[it.color]?.text || '#64748b' }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: isDarkMode ? '#e2e8f0' : '#1a1d29', flex: 1 }}>{it.label}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleSection(it.id); }}
                      style={{ flexShrink: 0, width: 32, height: 20, borderRadius: 9999, backgroundColor: isActive ? '#10b981' : (isDarkMode ? '#475569' : '#cbd5e1'), border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 2, justifyContent: isActive ? 'flex-end' : 'flex-start' }}
                    >
                      <div style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: 'white', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }} />
                    </button>
                  </button>
                );
              }
              const Icon = it.icon;
              const vid = 'visibilityId' in it ? (it as { visibilityId?: SectionId }).visibilityId : undefined;
              if (vid) {
                const isActive = currentVisibility[vid];
                const handleNavToPath = () => navigate(it.path);
                return (
                  <div
                    key={it.id}
                    style={{ width: '100%', padding: '12px 20px 12px 36px', display: 'flex', alignItems: 'center', gap: 12 }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <button onClick={handleNavToPath} style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: isDarkMode ? 'rgba(100, 116, 139, 0.15)' : 'rgba(235, 240, 245, 1)', border: 'none', cursor: 'pointer' }}>
                      <Icon size={18} style={{ color: isDarkMode ? '#94a3b8' : '#5a677b' }} />
                    </button>
                    <button onClick={handleNavToPath} style={{ flex: 1, fontSize: 13, fontWeight: 600, color: isDarkMode ? '#e2e8f0' : '#2d3748', textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>{it.label}</button>
                    <button onClick={(e) => { e.stopPropagation(); handleToggleSection(vid); }} style={{ flexShrink: 0, width: 32, height: 20, borderRadius: 9999, backgroundColor: isActive ? '#10b981' : (isDarkMode ? '#475569' : '#cbd5e1'), border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 2, justifyContent: isActive ? 'flex-end' : 'flex-start' }}>
                      <div style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: 'white', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }} />
                    </button>
                  </div>
                );
              }
              return (
                <button
                  key={it.id}
                  onClick={() => navigate(it.path)}
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
            </>
            ) : (
            <Popover open={dashboardsFlyoutOpen} onOpenChange={setDashboardsFlyoutOpen}>
              <PopoverTrigger asChild>
                <div
                  className="w-full"
                  onMouseEnter={() => { if (flyoutLeaveRef.current) clearTimeout(flyoutLeaveRef.current); setDashboardsFlyoutOpen(true); }}
                  onMouseLeave={() => { flyoutLeaveRef.current = window.setTimeout(() => setDashboardsFlyoutOpen(false), 150); }}
                >
                  <button
                    type="button"
                    style={{ width: '100%', padding: '10px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(100, 116, 139, 0.1)' }}>
                      <TrendingUp size={18} style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }} />
                    </div>
                  </button>
                </div>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="start"
                className="w-64 max-h-[70vh] overflow-y-auto p-1"
                onMouseEnter={() => { if (flyoutLeaveRef.current) clearTimeout(flyoutLeaveRef.current); setDashboardsFlyoutOpen(true); }}
                onMouseLeave={() => setDashboardsFlyoutOpen(false)}
              >
                <div className="py-0.5 space-y-0.5">
                  {DASHBOARD_CHILDREN.map((it, i) => {
                    if (it.type === 'subheader') {
                      const key = it.subsectionKey;
                      if (key === 'dashboard') return <div key={`sh-${i}`} className="px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{it.label}</div>;
                      const isExp = subExpanded[key];
                      return (
                        <button key={`sh-${i}`} type="button" onClick={() => setSubExpanded(key, !isExp)} className={cn("w-full flex items-center justify-between rounded-md px-2 py-1.5 text-xs font-semibold uppercase text-muted-foreground", isDarkMode ? "hover:bg-slate-700/50" : "hover:bg-slate-100")}>
                          {it.label}
                          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !isExp && "-rotate-90")} />
                        </button>
                      );
                    }
                    if (!subExpanded[it.subsectionKey]) return null;
                    if (it.type === 'section') {
                      const Icon = it.icon;
                      const isActive = currentVisibility[it.id];
                      return (
                        <button key={it.id} type="button" onClick={() => { onSectionClick?.(it.id); setDashboardsFlyoutOpen(false); }} className={cn("w-full flex items-center gap-2 rounded-md px-2 py-2 text-sm", isDarkMode ? "hover:bg-slate-700/50" : "hover:bg-slate-100")}>
                          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", isActive ? (isDarkMode ? "bg-slate-600/50" : "bg-slate-200") : (isDarkMode ? "bg-slate-700/30" : "bg-slate-100"))}>
                            <Icon className="h-4 w-4" style={{ color: colorMap[it.color]?.text }} />
                          </div>
                          <span className="flex-1 text-left truncate">{it.label}</span>
                          <button type="button" onClick={(e) => { e.stopPropagation(); handleToggleSection(it.id); }} className={cn("shrink-0 w-8 h-5 rounded-full flex items-center p-0.5", isActive ? "bg-emerald-500 justify-end" : (isDarkMode ? "bg-slate-600 justify-start" : "bg-slate-300 justify-start"))}>
                            <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
                          </button>
                        </button>
                      );
                    }
                    const Icon = it.icon;
                    const vid = 'visibilityId' in it ? (it as { visibilityId?: SectionId }).visibilityId : undefined;
                    if (vid) {
                      const isActive = currentVisibility[vid];
                      return (
                        <div key={it.id} className={cn("flex items-center gap-2 rounded-md px-2 py-2", isDarkMode ? "hover:bg-slate-700/50" : "hover:bg-slate-100")}>
                          <button type="button" onClick={() => { navigate(it.path); setDashboardsFlyoutOpen(false); }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted"><Icon className="h-4 w-4" /></button>
                          <button type="button" onClick={() => { navigate(it.path); setDashboardsFlyoutOpen(false); }} className="flex-1 text-left text-sm font-medium truncate">{it.label}</button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); handleToggleSection(vid); }} className={cn("shrink-0 w-8 h-5 rounded-full flex items-center p-0.5", isActive ? "bg-emerald-500 justify-end" : "bg-slate-300 dark:bg-slate-600 justify-start")}>
                            <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
                          </button>
                        </div>
                      );
                    }
                    return (
                      <button key={it.id} type="button" onClick={() => { navigate(it.path); setDashboardsFlyoutOpen(false); }} className={cn("w-full flex items-center gap-2 rounded-md px-2 py-2 text-sm", isDarkMode ? "hover:bg-slate-700/50" : "hover:bg-slate-100")}>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted"><Icon className="h-4 w-4" /></div>
                        <span className="flex-1 text-left truncate">{it.label}</span>
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
            )}
          </div>

          {/* Toptiering - main menu like Dashboards */}
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

          {/* My Workbench */}
          {isExpanded ? (
          <div
            style={{ width: '100%', padding: '12px 10px', display: 'flex', alignItems: 'center', gap: 10, transition: 'all 0.2s ease', cursor: 'pointer' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            onClick={() => navigate('/my-dashboard')}
          >
            <button onClick={(e) => { e.stopPropagation(); navigate('/my-dashboard'); }} style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(100, 116, 139, 0.1)', border: 'none', cursor: 'pointer' }}>
              <LayoutDashboard size={18} style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }} />
            </button>
            <button onClick={() => navigate('/my-dashboard')} style={{ flex: 1, fontSize: 14, fontWeight: 600, color: isDarkMode ? '#e2e8f0' : '#1a1d29', textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>My Workbench</button>
            <button onClick={(e) => { e.stopPropagation(); handleToggleSection('myWorkbench'); }} style={{ flexShrink: 0, width: 32, height: 20, borderRadius: 9999, backgroundColor: currentVisibility.myWorkbench ? '#10b981' : (isDarkMode ? '#475569' : '#cbd5e1'), border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 2, justifyContent: currentVisibility.myWorkbench ? 'flex-end' : 'flex-start' }}>
              <div style={{ width: 16, height: 16, borderRadius: '50%', backgroundColor: 'white', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }} />
            </button>
          </div>
          ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                style={{ width: '100%', padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, transition: 'all 0.2s ease', cursor: 'pointer' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(148, 163, 184, 0.08)' : 'rgba(0, 0, 0, 0.02)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                onClick={() => navigate('/my-dashboard')}
              >
                <button onClick={(e) => { e.stopPropagation(); navigate('/my-dashboard'); }} style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(100, 116, 139, 0.1)', border: 'none', cursor: 'pointer' }}>
                  <LayoutDashboard size={18} style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }} />
                </button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">My Workbench</TooltipContent>
          </Tooltip>
          )}
        </div>
        </SidebarContent>

        <SidebarFooter className="p-2 mt-auto border-t border-sidebar-border shrink-0">
          <BypassLandingToggle isExpanded={state !== 'collapsed'} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </>
  );
};
