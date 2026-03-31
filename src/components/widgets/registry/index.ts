/**
 * Widget Registry – central catalog of all available widget definitions.
 *
 * Import widget definition sets from each domain and combine them into
 * a single Map keyed by widget ID.
 */

import type { WidgetDefinition } from './types';
import type { ComponentType } from 'react';
import { companyScorecardWidgets } from './companyScorecardWidgets';
import { creditRiskWidgets } from './creditRiskWidgets';
import { salesScorecardWidgets } from './salesScorecardWidgets';
import { operationsScorecardWidgets } from './operationsScorecardWidgets';
import { operationsTrendsWidgets } from './operationsTrendsWidgets';
import { salesTrendsWidgets } from './salesTrendsWidgets';
import { loanFunnelWidgets } from './loanFunnelWidgets';
import { topTieringComparisonWidgets } from './topTieringComparisonWidgets';
import { leaderboardWidgets } from './leaderboardWidgets';
import { executiveDashboardWidgets } from './executiveDashboardWidgets';
import { closingForecastWidgets } from './closingForecastWidgets';
import { financialModelingWidgets } from './financialModelingWidgets';
import { aletheiaInsightsWidgets } from './aletheiaInsightsWidgets';
import { industryNewsWidgets } from './industryNewsWidgets';
import { loanDetailWidgets } from './loanDetailWidgets';
import { workflowConversionWidgets } from './workflowConversionWidgets';
import { highPerformersWidgets } from './highPerformersWidgets';
import { actorsWidgets } from './actorsWidgets';
import { pricingDashboardWidgets } from './pricingDashboardWidgets';
import { pipelineAnalysisWidgets } from './pipelineAnalysisWidgets';
import { salesScorecardOverviewWidgets } from './salesScorecardOverviewWidgets';

// Lock Stratification – import embed component once to avoid circular or chunk issues
import { LockStratificationEmbed } from '../components/LockStratificationEmbed';
import { loanComplexityWidgets } from './loanComplexityWidgets';
import { estimatedClosingsRiskWidgets } from './estimatedClosingsRiskWidgets';

const lockStratificationWidgets: WidgetDefinition[] = [
  { id: 'lock-stratification-kpis', name: 'Lock Stratification KPIs', description: 'Volume, units, average balance, avg days active, WAC, WA FICO, WA LTV, WA DTI', category: 'kpi', group: 'Lock Stratification', dataSource: 'lock-stratification', dataSelector: () => ({ ready: true }), defaultSize: { w: 24, h: 12 }, minSize: { w: 16, h: 8 }, config: { variant: 'kpis' }, component: LockStratificationEmbed as ComponentType<unknown> },
  { id: 'lock-stratification-interest-rates', name: 'Lock Stratification Interest Rates', description: 'Interest rate distribution bar chart with drill-down', category: 'chart', group: 'Lock Stratification', dataSource: 'lock-stratification', dataSelector: () => ({ ready: true }), defaultSize: { w: 24, h: 28 }, minSize: { w: 18, h: 20 }, config: { variant: 'interest-rates' }, component: LockStratificationEmbed as ComponentType<unknown> },
  { id: 'lock-stratification-days-to-expiration', name: 'Lock Stratification Days to Expiration', description: 'Table of loans by days to lock expiration', category: 'table', group: 'Lock Stratification', dataSource: 'lock-stratification', dataSelector: () => ({ ready: true }), defaultSize: { w: 24, h: 22 }, minSize: { w: 18, h: 14 }, config: { variant: 'days-to-expiration' }, component: LockStratificationEmbed as ComponentType<unknown> },
  { id: 'lock-stratification-pull-through', name: 'Lock Stratification Pull Through', description: 'Pull through | Locked to final disposition', category: 'chart', group: 'Lock Stratification', dataSource: 'lock-stratification', dataSelector: () => ({ ready: true }), defaultSize: { w: 24, h: 26 }, minSize: { w: 18, h: 18 }, config: { variant: 'pull-through' }, component: LockStratificationEmbed as ComponentType<unknown> },
  { id: 'lock-stratification-milestone-bar', name: 'Lock Stratification Active Loans (Bar)', description: 'Active loans by milestone – bar chart', category: 'chart', group: 'Lock Stratification', dataSource: 'lock-stratification', dataSelector: () => ({ ready: true }), defaultSize: { w: 24, h: 30 }, minSize: { w: 18, h: 22 }, config: { variant: 'milestone-bar' }, component: LockStratificationEmbed as ComponentType<unknown> },
  { id: 'lock-stratification-milestone-pivot', name: 'Lock Stratification Active Loans (Pivot)', description: 'Active loans by milestone – pivot table', category: 'table', group: 'Lock Stratification', dataSource: 'lock-stratification', dataSelector: () => ({ ready: true }), defaultSize: { w: 24, h: 26 }, minSize: { w: 18, h: 18 }, config: { variant: 'milestone-pivot' }, component: LockStratificationEmbed as ComponentType<unknown> },
];

// ---------------------------------------------------------------------------
// Aggregate all widgets
// ---------------------------------------------------------------------------

const allWidgets: WidgetDefinition[] = [
  ...companyScorecardWidgets,
  ...creditRiskWidgets,
  ...salesScorecardWidgets,
  ...operationsScorecardWidgets,
  ...operationsTrendsWidgets,
  ...salesTrendsWidgets,
  ...loanFunnelWidgets,
  ...topTieringComparisonWidgets,
  ...leaderboardWidgets,
  ...executiveDashboardWidgets,
  ...closingForecastWidgets,
  ...financialModelingWidgets,
  ...aletheiaInsightsWidgets,
  ...industryNewsWidgets,
  ...loanDetailWidgets,
  ...workflowConversionWidgets,
  ...highPerformersWidgets,
  ...actorsWidgets,
  ...pricingDashboardWidgets,
  ...pipelineAnalysisWidgets,
  ...salesScorecardOverviewWidgets,
  ...lockStratificationWidgets,
  ...loanComplexityWidgets,
  ...estimatedClosingsRiskWidgets,
];

// ---------------------------------------------------------------------------
// Registry Map (id -> definition)
// ---------------------------------------------------------------------------

export const widgetRegistry = new Map<string, WidgetDefinition>(
  allWidgets.map((w) => [w.id, w]),
);

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Get a widget definition by ID */
export function getWidgetDefinition(id: string): WidgetDefinition | undefined {
  return widgetRegistry.get(id);
}

/** Get all widgets in a specific group */
export function getWidgetsByGroup(group: string): WidgetDefinition[] {
  return allWidgets.filter((w) => w.group === group);
}

/** Get all widgets for a specific data source */
export function getWidgetsBySource(sourceId: string): WidgetDefinition[] {
  return allWidgets.filter((w) => w.dataSource === sourceId);
}

/** Get all unique group names (for catalog sections) */
export function getWidgetGroups(): string[] {
  return [...new Set(allWidgets.map((w) => w.group))];
}

/** Get all widgets as an array */
export function getAllWidgets(): WidgetDefinition[] {
  return allWidgets;
}

// Re-export types
export type { WidgetDefinition, WidgetRenderProps, WidgetInstance, DataSourceId, WidgetCategory } from './types';
