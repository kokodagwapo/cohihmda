/**
 * Widget definitions for Operations Scorecard Trends data source.
 *
 * Matches OperationScorecardTrends.tsx layout:
 * - 5 KPIs (Target Units/Month, Avg Output, Avg Volume, Complexity, Avg Days)
 * - Trends table (actors × months × 5 metrics per month)
 */

import type { WidgetDefinition, KPIData, TableData, TableColumn } from './types';
import { KPICard } from '../components/KPICard';
import { DataTable } from '../components/DataTable';

// ---------------------------------------------------------------------------
// Source shape (matches useOperationsScorecardTrendsData return)
// ---------------------------------------------------------------------------

interface MonthlyMetrics {
  unitsOutput: number;
  outputVsTarget: number;
  avgDays: number;
  conversionPercent: number;
  loanComplexityScore: number;
  volumeOutput: number;
}

interface ActorTrendsData {
  id: string;
  name: string;
  tier: 'top' | 'second' | 'bottom';
  ttsScore: number;
  months: Record<string, MonthlyMetrics>;
}

interface OpsTrendsSource {
  actors: ActorTrendsData[];
  months: string[];
  totals: Record<string, { unitsOutput: number; outputVsTarget: number; volumeOutput: number }>;
  tierSummary: {
    top: { tier: string; count: number; totalUnits: number; percentOfTotal: number; avgUnitsPerMonth: number; avgDaysPerUnit: number };
    second: { tier: string; count: number; totalUnits: number; percentOfTotal: number; avgUnitsPerMonth: number; avgDaysPerUnit: number };
    bottom: { tier: string; count: number; totalUnits: number; percentOfTotal: number; avgUnitsPerMonth: number; avgDaysPerUnit: number };
  };
  kpis: {
    targetUnitsPerMonth: number;
    avgUnitsOutput: number;
    avgVolumeOutput: number;
    avgLoanComplexityScore: number;
    avgDays: number;
  };
  dateRange: { start: string; end: string; monthsIncluded: number };
}

function t(raw: unknown): OpsTrendsSource {
  return raw as OpsTrendsSource;
}

// ---------------------------------------------------------------------------
// KPI Widgets
// ---------------------------------------------------------------------------

const opsTrendsTargetUnits: WidgetDefinition<KPIData> = {
  id: 'ops-trends-target-units',
  name: 'Target Units / Month',
  description: 'Monthly target units per actor',
  category: 'kpi',
  group: 'Operations Trends',
  dataSource: 'operations-trends',
  dataSelector: (raw) => ({
    value: t(raw).kpis?.targetUnitsPerMonth ?? 25,
    label: 'Target Units / Month',
    format: 'number',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const opsTrendsAvgOutput: WidgetDefinition<KPIData> = {
  id: 'ops-trends-avg-output',
  name: 'Avg Monthly Output',
  description: 'Average monthly units output',
  category: 'kpi',
  group: 'Operations Trends',
  dataSource: 'operations-trends',
  dataSelector: (raw) => ({
    value: t(raw).kpis?.avgUnitsOutput ?? 0,
    label: 'Avg Monthly Output',
    format: 'number',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const opsTrendsAvgVolume: WidgetDefinition<KPIData> = {
  id: 'ops-trends-avg-volume',
  name: 'Avg Volume Output',
  description: 'Average monthly volume output',
  category: 'kpi',
  group: 'Operations Trends',
  dataSource: 'operations-trends',
  dataSelector: (raw) => ({
    value: t(raw).kpis?.avgVolumeOutput ?? 0,
    label: 'Avg Volume Output',
    format: 'currency',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const opsTrendsComplexity: WidgetDefinition<KPIData> = {
  id: 'ops-trends-complexity',
  name: 'Loan Complexity',
  description: 'Average loan complexity score',
  category: 'kpi',
  group: 'Operations Trends',
  dataSource: 'operations-trends',
  dataSelector: (raw) => ({
    value: t(raw).kpis?.avgLoanComplexityScore ?? 100,
    label: 'Loan Complexity',
    format: 'number',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const opsTrendsAvgDays: WidgetDefinition<KPIData> = {
  id: 'ops-trends-avg-days',
  name: 'Average Days',
  description: 'Average processing days',
  category: 'kpi',
  group: 'Operations Trends',
  dataSource: 'operations-trends',
  dataSelector: (raw) => ({
    value: t(raw).kpis?.avgDays ?? 0,
    label: 'Average Days',
    format: 'days',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

// ---------------------------------------------------------------------------
// Trends Table (actors × months × metrics)
// Flattens monthly data into a table where each row is an actor and
// columns show the latest months' Units Output, vs Target, Avg Days, etc.
// ---------------------------------------------------------------------------

const opsTrendsTable: WidgetDefinition<TableData> = {
  id: 'ops-trends-table',
  name: 'Operations Trends Table',
  description: 'Monthly trends for each actor showing units, vs target, days, complexity',
  category: 'table',
  group: 'Operations Trends',
  dataSource: 'operations-trends',
  dataSelector: (raw) => {
    const d = t(raw);
    const months = (d.months ?? []).slice(0, 6); // Show up to 6 most recent months

    // Build dynamic columns: Actor name + per-month metrics
    const columns: TableColumn[] = [
      { key: 'name', label: 'Actor', sortable: true },
      { key: 'tier', label: 'Tier', sortable: true, align: 'center' },
    ];

    for (const month of months) {
      const short = month.length > 7 ? month.slice(0, 7) : month;
      columns.push(
        { key: `${month}_units`, label: `${short} Units`, sortable: true, align: 'right', format: 'number' },
        { key: `${month}_target`, label: `${short} vs Tgt`, sortable: true, align: 'right', format: 'number' },
        { key: `${month}_days`, label: `${short} Days`, sortable: true, align: 'right', format: 'days' },
      );
    }

    const rows: Record<string, unknown>[] = (d.actors ?? []).map((actor) => {
      const row: Record<string, unknown> = {
        name: actor.name,
        tier: actor.tier === 'top' ? 'Top' : actor.tier === 'second' ? '2nd' : 'Bottom',
      };
      for (const month of months) {
        const m = actor.months?.[month];
        row[`${month}_units`] = m?.unitsOutput ?? 0;
        row[`${month}_target`] = m?.outputVsTarget ?? 0;
        row[`${month}_days`] = m?.avgDays != null ? +(m.avgDays).toFixed(1) : '-';
      }
      return row;
    });

    // Add totals row
    if (d.totals && months.length > 0) {
      const totalsRow: Record<string, unknown> = { name: 'TOTALS', tier: '' };
      for (const month of months) {
        const mt = d.totals[month];
        totalsRow[`${month}_units`] = mt?.unitsOutput ?? 0;
        totalsRow[`${month}_target`] = mt?.outputVsTarget ?? 0;
        totalsRow[`${month}_days`] = '-';
      }
      rows.unshift(totalsRow);
    }

    return {
      title: 'Operations Trends',
      columns,
      rows,
      stickyFirstColumn: true,
    };
  },
  defaultSize: { w: 500, h: 220 },
  minSize: { w: 250, h: 112 },
  component: DataTable,
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const operationsTrendsWidgets: WidgetDefinition[] = [
  opsTrendsTargetUnits,
  opsTrendsAvgOutput,
  opsTrendsAvgVolume,
  opsTrendsComplexity,
  opsTrendsAvgDays,
  opsTrendsTable,
];
