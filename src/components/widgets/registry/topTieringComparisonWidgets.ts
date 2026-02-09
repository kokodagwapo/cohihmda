/**
 * Widget definitions for TopTiering Comparison data source.
 *
 * Matches TopTieringComparison.tsx layout:
 * - 4 KPIs (Total Revenue, Total Units, Total Volume, Avg Revenue BPS)
 * - 3 Charts (Revenue Pareto, Units Pareto, BPS by Actor)
 * - Detail table (8 columns from actors[])
 */

import type { WidgetDefinition, KPIData, ChartData, TableData, TableColumn } from './types';
import { KPICard } from '../components/KPICard';
import { ChartCard } from '../components/ChartCard';
import { DataTable } from '../components/DataTable';
import { getTierColor } from '@/utils/tierColors';

// ---------------------------------------------------------------------------
// Source shape (matches useTopTieringComparisonData return)
// ---------------------------------------------------------------------------

interface TTCActor {
  id: string;
  name: string;
  tier: 'top' | 'second' | 'bottom';
  revenue: number;
  units: number;
  volume: number;
  revenueBPS: number;
  revenuePerLoan: number;
  cumulativeRevenuePercent?: number;
  cumulativeUnitsPercent?: number;
}

interface TTCSource {
  actors: TTCActor[];
  totals: {
    revenue: number;
    units: number;
    volume: number;
    avgRevenueBPS: number;
    actorCount: number;
    avgRevenuePerActor: number;
    avgUnitsPerActor: number;
  };
  tierSummary: {
    top: { count: number; revenue: number; revenuePercent: number; units: number; unitsPercent: number; avgRevenue: number; avgUnits: number };
    second: { count: number; revenue: number; revenuePercent: number; units: number; unitsPercent: number; avgRevenue: number; avgUnits: number };
    bottom: { count: number; revenue: number; revenuePercent: number; units: number; unitsPercent: number; avgRevenue: number; avgUnits: number };
  };
}

function tc(raw: unknown): TTCSource {
  return raw as TTCSource;
}

// ---------------------------------------------------------------------------
// KPI Widgets
// ---------------------------------------------------------------------------

const ttcTotalRevenue: WidgetDefinition<KPIData> = {
  id: 'ttc-total-revenue',
  name: 'Total Revenue',
  description: 'Total revenue across all actors',
  category: 'kpi',
  group: 'TopTiering Comparison',
  dataSource: 'top-tiering-comparison',
  dataSelector: (raw) => ({
    value: tc(raw).totals?.revenue ?? 0,
    label: 'Total Revenue',
    format: 'currency',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const ttcTotalUnits: WidgetDefinition<KPIData> = {
  id: 'ttc-total-units',
  name: 'Total Units',
  description: 'Total units across all actors',
  category: 'kpi',
  group: 'TopTiering Comparison',
  dataSource: 'top-tiering-comparison',
  dataSelector: (raw) => ({
    value: tc(raw).totals?.units ?? 0,
    label: 'Total Units',
    format: 'number',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const ttcTotalVolume: WidgetDefinition<KPIData> = {
  id: 'ttc-total-volume',
  name: 'Total Volume',
  description: 'Total volume across all actors',
  category: 'kpi',
  group: 'TopTiering Comparison',
  dataSource: 'top-tiering-comparison',
  dataSelector: (raw) => ({
    value: tc(raw).totals?.volume ?? 0,
    label: 'Total Volume',
    format: 'currency',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const ttcAvgBPS: WidgetDefinition<KPIData> = {
  id: 'ttc-avg-bps',
  name: 'Avg Revenue BPS',
  description: 'Average revenue in basis points',
  category: 'kpi',
  group: 'TopTiering Comparison',
  dataSource: 'top-tiering-comparison',
  dataSelector: (raw) => ({
    value: tc(raw).totals?.avgRevenueBPS ?? 0,
    label: 'Avg Revenue BPS',
    format: 'number',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

// ---------------------------------------------------------------------------
// Chart Widgets (Pareto charts matching actual page)
// ---------------------------------------------------------------------------

const ttcRevenueChart: WidgetDefinition<ChartData> = {
  id: 'ttc-revenue-chart',
  name: 'Revenue by Actor',
  description: 'Pareto chart of revenue by actor',
  category: 'chart',
  group: 'TopTiering Comparison',
  dataSource: 'top-tiering-comparison',
  dataSelector: (raw) => {
    const d = tc(raw);
    const sorted = [...(d.actors ?? [])].sort((a, b) => b.revenue - a.revenue).slice(0, 20);
    const totalRev = sorted.reduce((s, a) => s + a.revenue, 0);
    let cumulative = 0;
    const data = sorted.map((a) => {
      cumulative += a.revenue;
      return {
        name: a.name?.length > 12 ? a.name.slice(0, 12) + '…' : a.name,
        revenue: a.revenue,
        tier: a.tier,
        cumulativePct: totalRev > 0 ? Math.round((cumulative / totalRev) * 1000) / 10 : 0,
      };
    });
    return {
      title: 'Revenue by Actor',
      chartType: 'bar' as const,
      data,
      series: [{ dataKey: 'revenue', name: 'Revenue' }],
      xAxisKey: 'name',
      yAxisLabel: 'Revenue ($)',
      colorAccessor: (row: Record<string, unknown>) => getTierColor(row.tier as string),
      cumulativeKey: 'cumulativePct',
    };
  },
  defaultSize: { w: 350, h: 200 },
  minSize: { w: 200, h: 120 },
  component: ChartCard,
};

const ttcUnitsChart: WidgetDefinition<ChartData> = {
  id: 'ttc-units-chart',
  name: 'Units by Actor',
  description: 'Pareto chart of units by actor',
  category: 'chart',
  group: 'TopTiering Comparison',
  dataSource: 'top-tiering-comparison',
  dataSelector: (raw) => {
    const d = tc(raw);
    const sorted = [...(d.actors ?? [])].sort((a, b) => b.units - a.units).slice(0, 20);
    const totalUnits = sorted.reduce((s, a) => s + a.units, 0);
    let cumulative = 0;
    const data = sorted.map((a) => {
      cumulative += a.units;
      return {
        name: a.name?.length > 12 ? a.name.slice(0, 12) + '…' : a.name,
        units: a.units,
        tier: a.tier,
        cumulativePct: totalUnits > 0 ? Math.round((cumulative / totalUnits) * 1000) / 10 : 0,
      };
    });
    return {
      title: 'Units by Actor',
      chartType: 'bar' as const,
      data,
      series: [{ dataKey: 'units', name: 'Units' }],
      xAxisKey: 'name',
      yAxisLabel: 'Units',
      colorAccessor: (row: Record<string, unknown>) => getTierColor(row.tier as string),
      cumulativeKey: 'cumulativePct',
    };
  },
  defaultSize: { w: 350, h: 200 },
  minSize: { w: 200, h: 120 },
  component: ChartCard,
};

const ttcBpsChart: WidgetDefinition<ChartData> = {
  id: 'ttc-bps-chart',
  name: 'Revenue BPS by Actor',
  description: 'Pareto chart of revenue BPS by actor',
  category: 'chart',
  group: 'TopTiering Comparison',
  dataSource: 'top-tiering-comparison',
  dataSelector: (raw) => {
    const d = tc(raw);
    const sorted = [...(d.actors ?? [])].sort((a, b) => b.revenueBPS - a.revenueBPS).slice(0, 20);
    const totalBps = sorted.reduce((s, a) => s + a.revenueBPS, 0);
    let cumulative = 0;
    const data = sorted.map((a) => {
      cumulative += a.revenueBPS;
      return {
        name: a.name?.length > 12 ? a.name.slice(0, 12) + '…' : a.name,
        bps: a.revenueBPS,
        tier: a.tier,
        cumulativePct: totalBps > 0 ? Math.round((cumulative / totalBps) * 1000) / 10 : 0,
      };
    });
    return {
      title: 'Revenue BPS by Actor',
      chartType: 'bar' as const,
      data,
      series: [{ dataKey: 'bps', name: 'Revenue BPS' }],
      xAxisKey: 'name',
      yAxisLabel: 'BPS',
      colorAccessor: (row: Record<string, unknown>) => getTierColor(row.tier as string),
      cumulativeKey: 'cumulativePct',
    };
  },
  defaultSize: { w: 350, h: 200 },
  minSize: { w: 200, h: 120 },
  component: ChartCard,
};

// ---------------------------------------------------------------------------
// Detail Table (8 columns matching actual page)
// ---------------------------------------------------------------------------

const ttcDetailTable: WidgetDefinition<TableData> = {
  id: 'ttc-detail-table',
  name: 'TopTiering Detail',
  description: 'Detail table with all actors and metrics',
  category: 'table',
  group: 'TopTiering Comparison',
  dataSource: 'top-tiering-comparison',
  dataSelector: (raw) => {
    const d = tc(raw);
    const columns: TableColumn[] = [
      { key: 'name', label: 'Name', sortable: true },
      { key: 'tier', label: 'Tier', sortable: true, align: 'center' },
      { key: 'revenue', label: 'Revenue', sortable: true, align: 'right', format: 'currency' },
      { key: 'units', label: 'Units', sortable: true, align: 'right', format: 'number' },
      { key: 'volume', label: 'Volume', sortable: true, align: 'right', format: 'currency' },
      { key: 'bps', label: 'Rev BPS', sortable: true, align: 'right', format: 'number' },
      { key: 'perLoan', label: 'Rev / Loan', sortable: true, align: 'right', format: 'currency' },
    ];
    const rows: Record<string, unknown>[] = (d.actors ?? []).map((a) => ({
      name: a.name,
      tier: a.tier === 'top' ? 'Top Tier' : a.tier === 'second' ? '2nd Tier' : 'Bottom',
      revenue: a.revenue,
      units: a.units,
      volume: a.volume,
      bps: +(a.revenueBPS ?? 0).toFixed(1),
      perLoan: a.revenuePerLoan,
    }));
    return { title: 'Detail by Actor', columns, rows, stickyFirstColumn: true };
  },
  defaultSize: { w: 500, h: 220 },
  minSize: { w: 250, h: 112 },
  component: DataTable,
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const topTieringComparisonWidgets: WidgetDefinition[] = [
  ttcTotalRevenue,
  ttcTotalUnits,
  ttcTotalVolume,
  ttcAvgBPS,
  ttcRevenueChart,
  ttcUnitsChart,
  ttcBpsChart,
  ttcDetailTable,
];
