/**
 * Widget definitions for Sales Trends data source.
 *
 * Matches SalesTrends.tsx layout:
 * - 4 KPIs (Total Units Closed, Total Volume, Active LOs, Avg Turn Time)
 * - 2 Charts (Monthly Performance bar, Fund Type pie)
 * - Loan Officers table (8 columns)
 */

import type { WidgetDefinition, KPIData, ChartData, TableData, TableColumn } from './types';
import { KPICard } from '../components/KPICard';
import { ChartCard } from '../components/ChartCard';
import { DataTable } from '../components/DataTable';

// ---------------------------------------------------------------------------
// Source shape (matches useSalesTrendsData return → SalesTrendsData)
// ---------------------------------------------------------------------------

interface LoanOfficer {
  id: string;
  name: string;
  initials: string;
  branch: string;
  branchNumber: string;
  tier: 'top' | '2nd' | 'bottom';
  closed: number;
  volume: number;
  marginBPS: number;
  trendPercent: number;
  daysAvg: number;
  ttsScore: number;
}

interface SalesTrendsSource {
  loanOfficers: LoanOfficer[];
  kpiMetrics: {
    totalUnits: number;
    totalVolume: number;
    activeLOs: number;
    avgTurnTime: number;
    topTierCount?: number;
  };
  fundTypeBreakdown: { name: string; value: number; fill: string }[];
  monthlyPerformance: { month: string; units: number; volume: number }[];
}

function t(raw: unknown): SalesTrendsSource {
  return raw as SalesTrendsSource;
}

// ---------------------------------------------------------------------------
// KPI Widgets
// ---------------------------------------------------------------------------

const stTotalUnits: WidgetDefinition<KPIData> = {
  id: 'sales-trends-total-units',
  name: 'Total Units Closed',
  description: 'Total units closed in the period',
  category: 'kpi',
  group: 'Sales Trends',
  dataSource: 'sales-trends',
  dataSelector: (raw) => ({
    value: t(raw).kpiMetrics?.totalUnits ?? 0,
    label: 'Total Units Closed',
    format: 'number',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const stTotalVolume: WidgetDefinition<KPIData> = {
  id: 'sales-trends-total-volume',
  name: 'Total Volume',
  description: 'Total volume in the period',
  category: 'kpi',
  group: 'Sales Trends',
  dataSource: 'sales-trends',
  dataSelector: (raw) => ({
    value: t(raw).kpiMetrics?.totalVolume ?? 0,
    label: 'Total Volume',
    format: 'currency',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const stActiveLOs: WidgetDefinition<KPIData> = {
  id: 'sales-trends-active-los',
  name: 'Active Loan Officers',
  description: 'Number of active loan officers',
  category: 'kpi',
  group: 'Sales Trends',
  dataSource: 'sales-trends',
  dataSelector: (raw) => {
    const d = t(raw);
    const topCount = (d.loanOfficers ?? []).filter(lo => lo.tier === 'top').length;
    return {
      value: d.kpiMetrics?.activeLOs ?? 0,
      label: 'Active Loan Officers',
      format: 'number' as const,
      subtitle: `${topCount} top tier`,
    };
  },
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const stAvgTurnTime: WidgetDefinition<KPIData> = {
  id: 'sales-trends-avg-turn-time',
  name: 'Avg Turn Time',
  description: 'Average turn time in days',
  category: 'kpi',
  group: 'Sales Trends',
  dataSource: 'sales-trends',
  dataSelector: (raw) => ({
    value: t(raw).kpiMetrics?.avgTurnTime ?? 0,
    label: 'Avg Turn Time (days)',
    format: 'days',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

// ---------------------------------------------------------------------------
// Chart Widgets
// ---------------------------------------------------------------------------

const stMonthlyPerformance: WidgetDefinition<ChartData> = {
  id: 'sales-trends-monthly-performance',
  name: 'Monthly Performance',
  description: 'Monthly units performance bar chart',
  category: 'chart',
  group: 'Sales Trends',
  dataSource: 'sales-trends',
  dataSelector: (raw) => {
    const d = t(raw);
    return {
      title: 'Monthly Performance',
      chartType: 'bar' as const,
      data: (d.monthlyPerformance ?? []).map((m) => ({
        name: m.month,
        units: m.units,
        volume: m.volume,
      })),
      series: [{ dataKey: 'units', name: 'Units', color: '#6366f1' }],
      xAxisKey: 'name',
      yAxisLabel: 'Units',
    };
  },
  defaultSize: { w: 350, h: 200 },
  minSize: { w: 200, h: 120 },
  component: ChartCard,
};

const stFundTypePie: WidgetDefinition<ChartData> = {
  id: 'sales-trends-fund-type',
  name: 'Units by Fund Type',
  description: 'Pie chart of units by fund type',
  category: 'chart',
  group: 'Sales Trends',
  dataSource: 'sales-trends',
  dataSelector: (raw) => {
    const d = t(raw);
    return {
      title: 'Units by Fund Type',
      chartType: 'pie' as const,
      data: (d.fundTypeBreakdown ?? []).map((ft) => ({
        name: ft.name,
        value: ft.value,
      })),
      series: [{ dataKey: 'value', name: 'Units' }],
      xAxisKey: 'name',
    };
  },
  defaultSize: { w: 350, h: 200 },
  minSize: { w: 200, h: 120 },
  component: ChartCard,
};

// ---------------------------------------------------------------------------
// Loan Officers Table (8 columns matching actual page)
// ---------------------------------------------------------------------------

const stLoanOfficerTable: WidgetDefinition<TableData> = {
  id: 'sales-trends-lo-table',
  name: 'Loan Officers',
  description: 'Loan officer performance table with closed, volume, margin, trend',
  category: 'table',
  group: 'Sales Trends',
  dataSource: 'sales-trends',
  dataSelector: (raw) => {
    const d = t(raw);
    const columns: TableColumn[] = [
      { key: 'name', label: 'Name', sortable: true },
      { key: 'branch', label: 'Branch', sortable: true },
      { key: 'closed', label: 'Closed', sortable: true, align: 'right', format: 'number' },
      { key: 'volume', label: 'Volume', sortable: true, align: 'right', format: 'currency' },
      { key: 'marginBPS', label: 'Margin BPS', sortable: true, align: 'right', format: 'number' },
      { key: 'trendPercent', label: 'Trend %', sortable: true, align: 'right', format: 'percent' },
      { key: 'daysAvg', label: 'Days Avg', sortable: true, align: 'right', format: 'days' },
      { key: 'tier', label: 'Tier', sortable: true, align: 'center' },
    ];
    const rows: Record<string, unknown>[] = (d.loanOfficers ?? []).map((lo) => ({
      name: lo.name,
      branch: lo.branch,
      closed: lo.closed,
      volume: lo.volume,
      marginBPS: lo.marginBPS,
      trendPercent: lo.trendPercent,
      daysAvg: lo.daysAvg,
      tier: lo.tier === 'top' ? 'Top Tier' : lo.tier === '2nd' ? '2nd Tier' : 'Bottom',
    }));
    return { title: 'Loan Officers', columns, rows, stickyFirstColumn: true };
  },
  defaultSize: { w: 500, h: 220 },
  minSize: { w: 250, h: 112 },
  component: DataTable,
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const salesTrendsWidgets: WidgetDefinition[] = [
  stTotalUnits,
  stTotalVolume,
  stActiveLOs,
  stAvgTurnTime,
  stMonthlyPerformance,
  stFundTypePie,
  stLoanOfficerTable,
];
