/**
 * Widget definitions for the Executive Dashboard (Business Overview).
 *
 * Single full-component embed that preserves all interactive features:
 * per-KPI timeframe selectors, click-to-open drill-down modals with
 * loan mix breakdowns, size distributions, animated KPI values, etc.
 */

import type { WidgetDefinition } from './types';
import { ExecDashboardEmbed } from '../components/ExecDashboardEmbed';

// ---------------------------------------------------------------------------
// Full embed widget
// ---------------------------------------------------------------------------

const execDashboardEmbed: WidgetDefinition = {
  id: 'exec-dashboard-embed',
  name: 'Business Overview',
  description: 'Full executive dashboard with 6 interactive KPI cards, per-KPI timeframes, and drill-down modals',
  category: 'table', // Use 'table' category for full-width sizing
  group: 'Business Overview',
  dataSource: 'executive-dashboard',
  dataSelector: () => ({ ready: true }), // Component does its own data fetching
  defaultSize: { w: 500, h: 650 },
  minSize: { w: 400, h: 400 },
  component: ExecDashboardEmbed as any,
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const executiveDashboardWidgets: WidgetDefinition[] = [
  execDashboardEmbed,
];
