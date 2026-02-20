/**
 * Widget Registry – central catalog of all available widget definitions.
 *
 * Import widget definition sets from each domain and combine them into
 * a single Map keyed by widget ID.
 */

import type { WidgetDefinition } from './types';
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
