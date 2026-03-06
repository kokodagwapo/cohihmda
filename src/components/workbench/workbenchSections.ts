/**
 * Workbench section configuration
 *
 * Shared constants that define which dashboard sections and standalone widgets
 * are available in the workbench. Extracted here to avoid circular imports
 * between WorkbenchCanvas, WorkbenchSidebar, and DashboardBrowser.
 */

import {
  BarChart3,
  Trophy,
  Target,
  ClipboardList,
  Shield,
  Filter,
  ArrowLeftRight,
  TrendingUp,
  LineChart,
  FileText,
  GitBranch,
  Users,
  DollarSign,
  Lock,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DashboardSectionItem = {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass?: string;
};

// ---------------------------------------------------------------------------
// Standalone widgets – lightweight self-contained components that render
// as a single `registry_widget` on the canvas (no WidgetGroup wrapper).
// Maps sidebar item ID → registry widget definition ID + default size.
// These are NOT shown in the Add menu or DashboardBrowser – they live on
// their own pages and can be placed on the canvas via Cohi AI actions.
// ---------------------------------------------------------------------------

export const STANDALONE_WIDGETS: Record<string, { defId: string; w: number; h: number }> = {
  aletheiaInsights:       { defId: 'aletheia-insights-embed', w: 600, h: 500 },
  industryNews:           { defId: 'industry-news-embed',     w: 600, h: 500 },
  financialModeling:      { defId: 'financial-modeling-embed', w: 800, h: 650 },
  closingFalloutForecast: { defId: 'closing-forecast-embed',  w: 900, h: 600 },
};

// ---------------------------------------------------------------------------
// Dashboard section groups – used by sidebar, Add dropdown, and DashboardBrowser.
// Only real multi-widget dashboard sections belong here.
// ---------------------------------------------------------------------------

export const DASHBOARD_SECTION_GROUPS: { label: string; items: DashboardSectionItem[] }[] = [
  {
    label: 'Dashboards',
    items: [
      { id: 'leaderboard', title: 'Leaderboard', icon: Trophy, iconClass: 'text-amber-500' },
      { id: 'executiveDashboard', title: 'Business Overview', icon: Target, iconClass: 'text-blue-500' },
      { id: 'closingFalloutForecast', title: 'Closing & Fallout Forecast', icon: BarChart3, iconClass: 'text-emerald-500' },
    ],
  },
  {
    label: 'Scorecards',
    items: [
      { id: 'companyScorecard', title: 'Company Scorecard', icon: ClipboardList, iconClass: 'text-indigo-500' },
      { id: 'salesScorecard', title: 'Sales Scorecard', icon: Target, iconClass: 'text-violet-500' },
      { id: 'salesScorecardOverview', title: 'Sales Scorecard Overview', icon: BarChart3, iconClass: 'text-violet-500' },
      { id: 'operationsScorecard', title: 'Operations Scorecard', icon: Target, iconClass: 'text-indigo-500' },
      { id: 'creditRiskManagement', title: 'Credit Risk Management', icon: Shield, iconClass: 'text-emerald-500' },
      { id: 'loanDetail', title: 'Loan Detail', icon: FileText, iconClass: 'text-sky-500' },
      { id: 'highPerformers', title: 'High Performers', icon: Trophy, iconClass: 'text-amber-500' },
      { id: 'actors', title: 'Actors', icon: Users, iconClass: 'text-cyan-500' },
    ],
  },
  {
    label: 'Trends & Analysis',
    items: [
      { id: 'loanFunnel', title: 'Loan Funnel', icon: Filter, iconClass: 'text-blue-500' },
      { id: 'workflowConversion', title: 'Workflow Conversion', icon: GitBranch, iconClass: 'text-teal-500' },
      { id: 'topTieringComparison', title: 'TopTiering Comparison', icon: ArrowLeftRight, iconClass: 'text-sky-500' },
      { id: 'salesTrends', title: 'Sales Trends', icon: TrendingUp, iconClass: 'text-emerald-500' },
      { id: 'operationsTrends', title: 'Operations Trends', icon: LineChart, iconClass: 'text-blue-500' },
      { id: 'pricingDashboard', title: 'Pricing Dashboard', icon: DollarSign, iconClass: 'text-emerald-500' },
      { id: 'pipelineAnalysis', title: 'Pipeline Analysis', icon: LineChart, iconClass: 'text-sky-500' },
      { id: 'lockStratification', title: 'Lock Stratification', icon: Lock, iconClass: 'text-blue-500' },
    ],
  },
];

export const DASHBOARD_SECTION_ITEMS = DASHBOARD_SECTION_GROUPS.flatMap((group) => group.items);
