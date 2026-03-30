/**
 * Shared search targets for dashboard/page search.
 * Used by SidebarRouteSearch in both Navigation (top nav) and ReportsSidebar.
 */

import type { SidebarRouteSearchTarget } from '@/components/dashboard/SidebarRouteSearch';

export function getSidebarSearchTargets(): SidebarRouteSearchTarget[] {
  const sectionTargets: SidebarRouteSearchTarget[] = [
    { id: 'section:aletheiaInsights', label: 'Cohi Daily Briefings', group: 'Insights', kind: 'section', sectionId: 'aletheiaInsights', keywords: ['insights', 'dashboard'] },
    { id: 'section:industryNews', label: 'Mortgage News', group: 'Insights', kind: 'section', sectionId: 'industryNews', keywords: ['insights', 'dashboard'] },
    { id: 'section:leaderboard', label: 'Leaderboard', group: 'Dashboards', kind: 'section', sectionId: 'leaderboard', keywords: ['dashboards', 'insights'] },
    { id: 'section:executiveDashboard', label: 'Business Overview', group: 'Dashboards', kind: 'section', sectionId: 'executiveDashboard', keywords: ['dashboards', 'insights'] },
    { id: 'section:closingFalloutForecast', label: 'Closing & Fallout Forecast', group: 'Dashboards', kind: 'section', sectionId: 'closingFalloutForecast', keywords: ['dashboards', 'insights'] },
  ];

  const toptieringTargets: SidebarRouteSearchTarget[] = [
    { id: 'route:topTieringComparison', label: 'TopTiering Comparison', group: 'TopTiering', kind: 'route', path: '/performance/toptiering-comparison', keywords: ['toptiering', 'top tiering', 'performance'] },
    { id: 'route:creditRiskManagement', label: 'Credit Risk Management', group: 'TopTiering', kind: 'route', path: '/credit-risk-management', keywords: ['toptiering', 'top tiering', 'performance'] },
    { id: 'route:companyScorecard', label: 'Company Scorecard', group: 'TopTiering', kind: 'route', path: '/company-scorecard', keywords: ['toptiering', 'top tiering', 'performance'] },
    { id: 'route:pricingDashboard', label: 'Pricing Dashboard', group: 'TopTiering', kind: 'route', path: '/pricing-dashboard', keywords: ['toptiering', 'top tiering', 'pricing'] },
    { id: 'route:lockStratification', label: 'Lock Stratification', group: 'TopTiering', kind: 'route', path: '/lock-stratification', keywords: ['toptiering', 'top tiering', 'lock', 'stratification', 'pipeline', 'active'] },
    { id: 'route:loanComplexity', label: 'Loan Complexity', group: 'TopTiering', kind: 'route', path: '/loan-complexity', keywords: ['toptiering', 'top tiering', 'loan', 'complexity', 'scoring', 'pipeline'] },
    { id: 'route:workflowConversion', label: 'Workflow Conversion', group: 'TopTiering', kind: 'route', path: '/workflow-conversion', keywords: ['toptiering', 'top tiering', 'performance'] },
    { id: 'route:highPerformers', label: 'High Performers', group: 'TopTiering', kind: 'route', path: '/high-performers', keywords: ['toptiering', 'top tiering', 'performance'] },
    { id: 'route:loanDetail', label: 'Loan Detail', group: 'TopTiering', kind: 'route', path: '/loan-detail', keywords: ['toptiering', 'top tiering', 'performance'] },
    { id: 'route:falloutForecastPage', label: 'Fallout Report', group: 'TopTiering', kind: 'route', path: '/fallout-forecast', keywords: ['fallout', 'closing', 'risk', 'report'] },
    { id: 'route:salesScorecard', label: 'Sales Scorecard', group: 'TopTiering', kind: 'route', path: '/sales-scorecard', keywords: ['toptiering', 'top tiering', 'performance'] },
    { id: 'route:salesTrends', label: 'Sales Trends', group: 'TopTiering', kind: 'route', path: '/sales-trends', keywords: ['toptiering', 'top tiering', 'performance'] },
    { id: 'route:operationsScorecard', label: 'Operations Scorecard', group: 'TopTiering', kind: 'route', path: '/performance/operation-scorecard', keywords: ['toptiering', 'top tiering', 'performance'] },
    { id: 'route:operationsTrends', label: 'Operations Trends', group: 'TopTiering', kind: 'route', path: '/performance/operation-scorecard-trends', keywords: ['toptiering', 'top tiering', 'performance'] },
    { id: 'route:estimatedClosingsRisk', label: 'Estimated Closings and Risk Analysis', group: 'TopTiering', kind: 'route', path: '/performance/estimated-closings-risk', keywords: ['operations', 'estimated closings', 'risk analysis', 'ecd', 'dashboard'] },
    { id: 'route:financialModeling', label: 'Financial Modeling Sandbox', group: 'TopTiering', kind: 'route', path: '/performance/financial-modeling-sandbox', keywords: ['toptiering', 'top tiering', 'performance'] },
    { id: 'route:captureAnalysis', label: 'Capture Analysis', group: 'TopTiering', kind: 'route', path: '/capture-analysis', keywords: ['capture', 'builder', 'cohibuilder', 'portfolio', 'csv', 'import'] },
  ];

  const pageTargets: SidebarRouteSearchTarget[] = [
    { id: 'route:insights', label: 'Insights', group: 'Pages', kind: 'route', path: '/insights', keywords: ['home', 'dashboard'] },
    { id: 'route:workbench-hub', label: 'Workbench Hub', group: 'Pages', kind: 'route', path: '/workbench', keywords: ['workbench', 'canvas', 'hub'] },
    { id: 'route:my-workbench', label: 'My Workbench Editor', group: 'Pages', kind: 'route', path: '/my-dashboard', keywords: ['workbench', 'canvas', 'editor'] },
    { id: 'route:research-hub', label: 'Research Hub', group: 'Pages', kind: 'route', path: '/research', keywords: ['research', 'hub', 'sessions'] },
    { id: 'route:research-session', label: 'Research Session', group: 'Pages', kind: 'route', path: '/research/session', keywords: ['research', 'session', 'analysis'] },
    { id: 'route:loans', label: 'Loans', group: 'Pages', kind: 'route', path: '/loans', keywords: ['pipeline'] },
    { id: 'route:fallout-forecast', label: 'Coheus Fallout Report', group: 'Pages', kind: 'route', path: '/fallout-forecast', keywords: ['fallout', 'forecast', 'risk', 'closing'] },
    { id: 'route:settings', label: 'Settings', group: 'Pages', kind: 'route', path: '/settings', keywords: ['profile', 'preferences'] },
    { id: 'route:help', label: 'Help Center', group: 'Pages', kind: 'route', path: '/help', keywords: ['support', 'docs'] },
    { id: 'route:agentic-security', label: 'Agentic AI & data security', group: 'Pages', kind: 'route', path: '/agentic-security', keywords: ['soc2', 'soc 2', 'compliance', 'openai', 'anthropic', 'gemini', 'privacy', 'security', 'ai', 'agent'] },
    { id: 'route:workbench-shared', label: 'Workbench: Shared', group: 'Pages', kind: 'route', path: '/workbench/shared', keywords: ['workbench', 'shared'] },
    { id: 'route:workbench-team', label: 'Workbench: Team Folders', group: 'Pages', kind: 'route', path: '/workbench/team-folders', keywords: ['workbench', 'team'] },
    { id: 'route:workbench-favorites', label: 'Workbench: Favorites', group: 'Pages', kind: 'route', path: '/workbench/favorites', keywords: ['workbench', 'favorites'] },
    { id: 'route:distribution-center', label: 'Communications Center', group: 'Pages', kind: 'route', path: '/workbench/distributions', keywords: ['communications', 'communications center', 'distribution', 'distribution center', 'workbench', 'schedules'] },
  ];

  return [...sectionTargets, ...toptieringTargets, ...pageTargets];
}
