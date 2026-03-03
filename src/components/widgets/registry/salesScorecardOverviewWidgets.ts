/**
 * Sales Scorecard Overview – chart and table as separate workbench widgets.
 * Pipeline stage by period; filters (measure, period, time, branch, LO, dynamic, bookmarks) in group header.
 */

import React from 'react';
import type { WidgetDefinition } from './types';
import { SalesScorecardOverviewEmbed } from '../components/SalesScorecardOverviewEmbed';

const salesScorecardOverviewChart: WidgetDefinition = {
  id: 'sales-scorecard-overview-chart',
  name: 'Sales Scorecard Overview (Chart)',
  description: 'Pipeline stage by period – bar chart',
  category: 'chart',
  group: 'Sales Scorecard Overview',
  dataSource: 'sales-scorecard-overview',
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 24, h: 20 },
  minSize: { w: 18, h: 14 },
  config: { variant: 'chart' },
  component: SalesScorecardOverviewEmbed as React.ComponentType<any>,
};

const salesScorecardOverviewTable: WidgetDefinition = {
  id: 'sales-scorecard-overview-table',
  name: 'Sales Scorecard Overview (Table)',
  description: 'Pipeline stage by period – data table',
  category: 'table',
  group: 'Sales Scorecard Overview',
  dataSource: 'sales-scorecard-overview',
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 36, h: 20 },
  minSize: { w: 24, h: 12 },
  config: { variant: 'table' },
  component: SalesScorecardOverviewEmbed as React.ComponentType<any>,
};

export const salesScorecardOverviewWidgets: WidgetDefinition[] = [
  salesScorecardOverviewChart,
  salesScorecardOverviewTable,
];
